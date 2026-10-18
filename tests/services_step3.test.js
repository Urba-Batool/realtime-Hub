const presence = require('../src/services/presence.service');
const channel = require('../src/services/channel.service');
const { redis } = require('../src/redis/client');

describe('Step 3: Presence and Channel Services', () => {
  const userA = { id: 'u_alice', username: 'alice' };
  const userB = { id: 'u_bob', username: 'bob' };

  beforeAll(async () => {
    // Flush test keys or ensure clean state
    await redis.flushdb();
  });

  afterAll(async () => {
    // Connections are torn down by jest --forceExit.
    // Do not quit the shared ioredis singleton here; auth_step2 runs next
    // in the same process and needs it.
  });

  describe('Presence Service', () => {
    test('connect returns true for first socket, false for second socket', async () => {
      const first = await presence.connect(userA, 'sock_a_1');
      expect(first).toBe(true);

      const second = await presence.connect(userA, 'sock_a_2');
      expect(second).toBe(false);
    });

    test('listOnline returns online users', async () => {
      await presence.connect(userB, 'sock_b_1');
      const online = await presence.listOnline();
      const usernames = online.map((u) => u.username);
      expect(usernames).toContain('alice');
      expect(usernames).toContain('bob');
    });

    test('heartbeat updates user timestamp', async () => {
      await expect(presence.heartbeat(userA)).resolves.not.toThrow();
    });

    test('disconnect returns false until last socket disconnects', async () => {
      const disc1 = await presence.disconnect(userA, 'sock_a_1');
      expect(disc1).toBe(false);

      const disc2 = await presence.disconnect(userA, 'sock_a_2');
      expect(disc2).toBe(true);

      const online = await presence.listOnline();
      const usernames = online.map((u) => u.username);
      expect(usernames).not.toContain('alice');
      expect(usernames).toContain('bob');
    });
  });

  describe('Channel Service', () => {
    test('ensureDefaults creates default channels', async () => {
      await channel.ensureDefaults();
      const chList = await channel.list();
      const names = chList.map((c) => c.name);
      expect(names).toContain('general');
      expect(names).toContain('random');
      expect(names).toContain('tech');
    });

    test('join returns true for first socket and false for additional sockets', async () => {
      const first = await channel.join('general', userA);
      expect(first).toBe(true);

      const second = await channel.join('general', userA);
      expect(second).toBe(false);

      const membersList = await channel.members('general');
      expect(membersList).toEqual(
        expect.arrayContaining([{ id: userA.id, username: userA.username }])
      );
    });

    test('saveMessage and history store and retrieve messages in chronological order', async () => {
      const msg1 = await channel.saveMessage('general', userA, 'First message');
      const msg2 = await channel.saveMessage('general', userB, 'Second message');

      expect(msg1.text).toBe('First message');
      expect(msg2.text).toBe('Second message');

      const hist = await channel.history('general');
      expect(hist.length).toBeGreaterThanOrEqual(2);
      expect(hist[hist.length - 2].text).toBe('First message');
      expect(hist[hist.length - 1].text).toBe('Second message');
    });

    test('leave returns false until last socket leaves', async () => {
      const leave1 = await channel.leave('general', userA);
      expect(leave1).toBe(false);

      const leave2 = await channel.leave('general', userA);
      expect(leave2).toBe(true);

      const membersList = await channel.members('general');
      const ids = membersList.map((m) => m.id);
      expect(ids).not.toContain(userA.id);
    });
  });
});
