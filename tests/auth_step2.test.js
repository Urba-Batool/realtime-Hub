const http = require('http');
const { io: Client } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const { app, server } = require('../src/server');
const config = require('../src/config');
const { redis, pubClient, subClient } = require('../src/redis/client');

describe('Step 2: Authentication and Logging Verification', () => {
  let port;
  let serverInstance;

  beforeAll((done) => {
    serverInstance = server.listen(0, () => {
      port = serverInstance.address().port;
      done();
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => serverInstance.close(resolve));
    await redis.quit();
    await pubClient.quit();
    await subClient.quit();
  });

  test('Rejects socket connection without token', (done) => {
    const socket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toBe('Authentication required');
      socket.close();
      done();
    });

    socket.on('connect', () => {
      socket.close();
      done(new Error('Should not have connected without token'));
    });
  });

  test('Logs in via /login and connects successfully, logging connect and disconnect', async () => {
    // 1. Post to /login
    const loginRes = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser' }),
    });

    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.token).toBeDefined();
    expect(loginData.user.username).toBe('testuser');

    // 2. Connect with token
    const socket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: loginData.token },
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        resolve();
      });
      socket.on('connect_error', reject);
    });

    expect(socket.connected).toBe(true);

    // 3. Disconnect
    socket.disconnect();

    // 4. Wait a bit for winston daily rotate file write flush
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 5. Check log files
    const logFiles = fs.readdirSync(path.resolve(config.logDir));
    const transFiles = logFiles.filter((f) => f.startsWith('transactions-'));
    expect(transFiles.length).toBeGreaterThan(0);

    const logContent = fs.readFileSync(
      path.resolve(config.logDir, transFiles[0]),
      'utf8'
    );
    expect(logContent).toContain('"event":"connect"');
    expect(logContent).toContain('"event":"disconnect"');
  });
});
