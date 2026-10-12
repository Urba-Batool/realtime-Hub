const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');

const config = require('./config');
const logger = require('./utils/logger');
const { pubClient, subClient } = require('./redis/client');
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static('public'));

app.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
  }
  const id = `u_${username.toLowerCase()}`;
  const token = jwt.sign({ id, username }, config.jwtSecret, { expiresIn: '12h' });
  res.json({ token, user: { id, username } });
});

const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

io.adapter(createAdapter(pubClient, subClient));
io.use(authMiddleware);

io.on('connection', (socket) => {
  logger.transaction('connect', { userId: socket.user.id, socketId: socket.id });

  socket.on('disconnect', () => {
    logger.transaction('disconnect', { userId: socket.user.id, socketId: socket.id });
  });
});

if (require.main === module) {
  server.listen(config.port, () => {
    logger.info('server_started', { port: config.port });
  });
}

module.exports = { app, server, io };
