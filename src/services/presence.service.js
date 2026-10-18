const { redis } = require('../redis/client');
const config = require('../config');

const userKey = (id) => `user:${id}`;
const socketsKey = (id) => `user:${id}:sockets`;
const ONLINE = 'online_users';
const staleBefore = () => Date.now() - config.presenceTtlSec * 1000;

// Returns true when this is the user's first open socket (user just came online).
async function connect(user, socketId) {
  const now = Date.now();
  const res = await redis
    .multi()
    .sadd(socketsKey(user.id), socketId)
    .hsetnx(userKey(user.id), 'connectedAt', new Date(now).toISOString())
    .hmset(userKey(user.id), { username: user.username, lastSeen: now })
    .zadd(ONLINE, now, user.id)
    .scard(socketsKey(user.id))
    .exec();
  const socketCount = res[4][1];
  return socketCount === 1;
}

// Returns true when the user has no sockets left (user just went offline).
async function disconnect(user, socketId) {
  await redis.srem(socketsKey(user.id), socketId);
  const remaining = await redis.scard(socketsKey(user.id));
  if (remaining === 0) {
    await redis.multi().zrem(ONLINE, user.id).del(userKey(user.id), socketsKey(user.id)).exec();
    return true;
  }
  return false;
}

// Called on an interval for every connected socket so crashed clients expire.
async function heartbeat(user) {
  const now = Date.now();
  await redis.multi().zadd(ONLINE, now, user.id).hset(userKey(user.id), 'lastSeen', now).exec();
}

async function listOnline() {
  await redis.zremrangebyscore(ONLINE, '-inf', staleBefore());
  const ids = await redis.zrangebyscore(ONLINE, staleBefore(), '+inf');
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  ids.forEach((id) => pipe.hget(userKey(id), 'username'));
  const names = await pipe.exec();
  return ids.map((id, i) => ({ id, username: names[i][1] || id }));
}

module.exports = { connect, disconnect, heartbeat, listOnline };
