const fs = require('fs');
const path = require('path');
const { io: ioc } = require('socket.io-client');
const { start, io } = require('../src/server');
const { redis, pubClient, subClient } = require('../src/redis/client');
const config = require('../src/config');

jest.setTimeout(20000);

const uniq = Date.now().toString(36).slice(-5);
let port;
const url = () => `http://localhost:${port}`;

async function login(username) {
  const res = await fetch(`${url()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  return { status: res.status, ...(await res.json()) };
}
const connectClient = (token) =>
  new Promise((resolve, reject) => {
    const s = ioc(url(), { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const emit = (s, event, payload) => new Promise((resolve) => s.emit(event, payload, resolve));
const once = (s, event) => new Promise((resolve) => s.once(event, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};

describe('Realtime hub', () => {
  const channel = `room_${uniq}`;
  let A, B, alice, bob, lastMessageId;

  beforeAll(async () => {
    port = await start(0); // 0 = random free port
    A = await login(`alice_${uniq}`);
    B = await login(`bob_${uniq}`);
    alice = await connectClient(A.token);
    bob = await connectClient(B.token);
  });

  afterAll(async () => {
    alice.close();
    bob.close();
    await sleep(300);
    await new Promise((resolve) => io.close(resolve));
    await Promise.allSettled([redis.quit(), pubClient.quit(), subClient.quit()]);
  });

  test('login rejects an invalid username', async () => {
    const res = await login('x');
    expect(res.status).toBe(400);
  });

  test('connection without a token is rejected', async () => {
    await expect(connectClient(undefined)).rejects.toThrow('Authentication required');
  });

  test('connection with a bad token is rejected', async () => {
    await expect(connectClient('not.a.token')).rejects.toThrow('Invalid or expired token');
  });

  test('joining returns history and members, and notifies others', async () => {
    const r1 = await emit(alice, 'channel:join', { channel });
    expect(r1.ok).toBe(true);
    expect(r1.members.map((m) => m.id)).toContain(A.user.id);

    const notified = once(alice, 'channel:user_joined');
    const r2 = await emit(bob, 'channel:join', { channel });
    expect(r2.members).toHaveLength(2);
    expect((await notified).user.id).toBe(B.user.id);
  });

  test('channel list shows the new channel with its member count', async () => {
    const res = await emit(alice, 'channel:list', {});
    const entry = res.channels.find((c) => c.name === channel);
    expect(entry.members).toBe(2);
  });

  test('a message reaches the channel and is cached in Redis', async () => {
    const received = once(bob, 'message:new');
    const ack = await emit(alice, 'message:send', { channel, text: 'hello team' });
    expect(ack.ok).toBe(true);
    const msg = await received;
    expect(msg.text).toBe('hello team');
    expect(msg.username).toBe(A.user.username);
    const cached = await redis.lrange(`channel:${channel}:history`, 0, -1);
    expect(cached.some((m) => JSON.parse(m).id === msg.id)).toBe(true);
    lastMessageId = msg.id;
  });

  test('invalid channel names and bad messages are refused', async () => {
    expect((await emit(alice, 'channel:join', { channel: 'bad name!' })).ok).toBe(false);
    expect((await emit(alice, 'message:send', { channel, text: '   ' })).ok).toBe(false);
    expect((await emit(alice, 'message:send', { channel, text: 'x'.repeat(5000) })).ok).toBe(false);
  });

  test('sending without joining the channel is refused', async () => {
    const carol = await login(`carol_${uniq}`);
    const sock = await connectClient(carol.token);
    const res = await emit(sock, 'message:send', { channel, text: 'sneaky' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Join the channel/);
    sock.close();
  });

  test('private messages reach the recipient, and offline users are reported', async () => {
    const received = once(bob, 'message:private');
    const ack = await emit(alice, 'message:private', { to: B.user.id, text: 'psst' });
    expect(ack.ok).toBe(true);
    expect((await received).text).toBe('psst');

    const offline = await emit(alice, 'message:private', { to: 'u_ghost_user', text: 'hello?' });
    expect(offline.ok).toBe(false);
    expect(offline.error).toMatch(/offline/);
  });

  test('rate limiting blocks a burst of messages', async () => {
    const dave = await login(`dave_${uniq}`);
    const sock = await connectClient(dave.token);
    await emit(sock, 'channel:join', { channel });
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => emit(sock, 'message:send', { channel, text: `burst ${i}` }))
    );
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(config.rateLimit.max);
    expect(results.some((r) => !r.ok && /slow down/.test(r.error))).toBe(true);
    sock.close();
  });

  test('message transactions are written to the log files with timestamps', async () => {
    await sleep(800); // let the file transport flush
    const dir = path.resolve(config.logDir);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('transactions-'));
    const text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const line = text.split('\n').find((l) => l.includes(lastMessageId));
    expect(line).toBeDefined();
    const entry = JSON.parse(line);
    expect(entry.event).toBe('message:send');
    expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
  });

  test('presence lists online users and drops them after disconnect', async () => {
    const online = await emit(bob, 'presence:list', {});
    expect(online.users.map((u) => u.id)).toContain(A.user.id);

    alice.close();
    const gone = await waitFor(async () => {
      const res = await emit(bob, 'presence:list', {});
      return !res.users.some((u) => u.id === A.user.id);
    });
    expect(gone).toBe(true);
  });
});
