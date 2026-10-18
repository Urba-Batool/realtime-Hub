const crypto = require('crypto');
const { redis } = require('../redis/client');
const config = require('../config');

const DEFAULT_CHANNELS = ['general', 'random', 'tech', 'design'];
const countsKey = (c) => `channel:${c}:counts`;
const namesKey = (c) => `channel:${c}:names`;
const historyKey = (c) => `channel:${c}:history`;

async function ensureDefaults() {
  await redis.sadd('channels', ...DEFAULT_CHANNELS);
}

// Returns true when the user was not yet in the channel (first socket joined).
async function join(channel, user) {
  await redis.sadd('channels', channel);
  const count = await redis.hincrby(countsKey(channel), user.id, 1);
  await redis.hset(namesKey(channel), user.id, user.username);
  return count === 1;
}

// Returns true when the user has fully left (no sockets remain in the channel).
async function leave(channel, user) {
  const count = await redis.hincrby(countsKey(channel), user.id, -1);
  if (count <= 0) {
    await redis.multi().hdel(countsKey(channel), user.id).hdel(namesKey(channel), user.id).exec();
    return true;
  }
  return false;
}

async function members(channel) {
  const names = await redis.hgetall(namesKey(channel));
  return Object.entries(names).map(([id, username]) => ({ id, username }));
}

async function list() {
  const names = (await redis.smembers('channels')).sort();
  const pipe = redis.pipeline();
  names.forEach((c) => pipe.hlen(countsKey(c)));
  const sizes = await pipe.exec();
  return names.map((name, i) => ({ name, members: sizes[i][1] }));
}

async function saveMessage(channel, user, text) {
  const message = {
    id: crypto.randomUUID(),
    channel,
    userId: user.id,
    username: user.username,
    text,
    ts: new Date().toISOString(),
  };
  await redis
    .multi()
    .lpush(historyKey(channel), JSON.stringify(message))
    .ltrim(historyKey(channel), 0, config.historyLimit - 1)
    .exec();
  return message;
}

async function history(channel) {
  const raw = await redis.lrange(historyKey(channel), 0, config.historyLimit - 1);
  return raw.map((m) => JSON.parse(m)).reverse(); // oldest first
}

module.exports = { ensureDefaults, join, leave, members, list, saveMessage, history };
