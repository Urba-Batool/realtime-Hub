const { io } = require('socket.io-client');
const fs = require('fs');
const { performance } = require('perf_hooks');

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const URL = args.url || 'http://localhost:3000';
const CLIENTS = Number(args.clients || 500);
const CHANNELS = Number(args.channels || 10);
const DURATION = Number(args.duration || 30);
const INTERVAL = Number(args.interval || 5000);
const RAMP = Number(args.ramp || 50);
const runId = Date.now().toString(36).slice(-4);

const stats = {
  connected: 0, failed: 0, sent: 0, acked: 0, rejected: 0, deliveries: 0,
  e2e: [], ack: [], connectMs: [],
};
const clients = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (values, percentile) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((percentile / 100) * sorted.length))].toFixed(1));
};

async function createClient(index) {
  const startedAt = performance.now();
  const response = await fetch(`${URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `load_${runId}_${index}` }),
  });
  const { token, user } = await response.json();
  if (!response.ok || !token) throw new Error('Login failed');

  const socket = io(URL, { auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  stats.connectMs.push(performance.now() - startedAt);

  const channel = `load_${runId}_${index % CHANNELS}`;
  const joined = await new Promise((resolve) => socket.emit('channel:join', { channel }, resolve));
  if (!joined.ok) throw new Error(joined.error);

  socket.on('message:new', (message) => {
    stats.deliveries += 1;
    if (message.userId === user.id) stats.e2e.push(Date.now() - Number(message.text.split(':')[1]));
  });
  const client = { index, socket, channel, timer: null };
  clients.push(client);
  stats.connected += 1;
  return client;
}

function startSending(client) {
  setTimeout(() => {
    client.timer = setInterval(() => {
      const startedAt = performance.now();
      stats.sent += 1;
      client.socket.emit('message:send', {
        channel: client.channel,
        text: `ping:${Date.now()}:${client.index}`,
      }, (response) => {
        if (response?.ok) {
          stats.acked += 1;
          stats.ack.push(performance.now() - startedAt);
        } else {
          stats.rejected += 1;
        }
      });
    }, INTERVAL);
  }, Math.random() * INTERVAL);
}

(async () => {
  console.log(`Load test: ${CLIENTS} clients, ${CHANNELS} channels, 1 message per ${INTERVAL} ms each, ${DURATION}s`);

  for (let start = 0; start < CLIENTS; start += RAMP) {
    const batch = Array.from({ length: Math.min(RAMP, CLIENTS - start) }, (_, offset) => createClient(start + offset));
    const results = await Promise.allSettled(batch);
    stats.failed += results.filter((result) => result.status === 'rejected').length;
    process.stdout.write(`\rConnected ${stats.connected}/${CLIENTS} (failed ${stats.failed})`);
    await sleep(1000);
  }
  console.log('\nRamp-up done, sending messages...');

  const sendStartedAt = Date.now();
  clients.forEach(startSending);
  await sleep(DURATION * 1000);
  clients.forEach((client) => clearInterval(client.timer));
  const elapsed = (Date.now() - sendStartedAt) / 1000;
  await sleep(2000);

  const report = {
    clients: CLIENTS,
    connectedOk: stats.connected,
    connectFailed: stats.failed,
    messagesSent: stats.sent,
    messagesAcked: stats.acked,
    messagesRejected: stats.rejected,
    deliveriesReceived: stats.deliveries,
    sendRatePerSec: Number((stats.sent / elapsed).toFixed(1)),
    deliveryRatePerSec: Number((stats.deliveries / elapsed).toFixed(1)),
    connectMs: { p50: pct(stats.connectMs, 50), p95: pct(stats.connectMs, 95) },
    ackMs: { p50: pct(stats.ack, 50), p95: pct(stats.ack, 95), p99: pct(stats.ack, 99) },
    deliveryMs: { p50: pct(stats.e2e, 50), p95: pct(stats.e2e, 95), p99: pct(stats.e2e, 99) },
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(`load-test/results-${CLIENTS}-clients.json`, JSON.stringify(report, null, 2));

  clients.forEach((client) => client.socket.close());
  setTimeout(() => process.exit(0), 500);
})().catch((error) => {
  console.error(error);
  clients.forEach((client) => client.socket.close());
  process.exit(1);
});
