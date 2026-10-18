const express = require('express');
const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const config = require('./config');
const logger = require('./utils/logger');
const { redis, pubClient, subClient } = require('./redis/client');
const authMiddleware = require('./middleware/auth');
const registerSockets = require('./sockets');
const channelService = require('./services/channel.service');

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (req, res) => {
  try {
    if (redis.status !== 'ready') throw new Error('redis down');
    await redis.ping();
    res.json({ status: 'ok', redis: 'up', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', redis: 'down' });
  }
});

app.post('/login', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
  }
  const id = `u_${username.toLowerCase()}`;
  const token = jwt.sign({ id, username }, config.jwtSecret, { expiresIn: '12h' });
  res.json({ token, user: { id, username } });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5, // 100 KB per event, blocks oversized payloads
});

io.adapter(createAdapter(pubClient, subClient));
io.use(authMiddleware);
registerSockets(io);

io.engine.on('connection_error', (err) => {
  logger.warn('engine_connection_error', { code: err.code, message: err.message });
});

async function start(port = config.port) {
  await channelService.ensureDefaults();
  await new Promise((resolve) => server.listen(port, resolve));
  const actual = server.address().port;
  logger.info('server_started', { port: actual });
  return actual;
}

async function shutdown(signal) {
  logger.info('shutdown_started', { signal });
  const force = setTimeout(() => process.exit(1), 10000); // hard stop after 10 s
  force.unref();

  io.emit('server:shutdown');
  io.close(async () => {
    // Give the 'disconnecting' cleanups a moment to finish writing to Redis.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.allSettled([redis.quit(), pubClient.quit(), subClient.quit()]);
    logger.info('shutdown_complete');
    logger.on('finish', () => process.exit(0));
    logger.end(); // flush log files before exiting
  });
}

if (require.main === module) {
  start();
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('message', (msg) => {
    if (msg === 'SIGINT') shutdown('SIGINT');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', { error: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { error: err.message });
    shutdown('uncaughtException');
  });
}

module.exports = { app, server, io, start, shutdown };
