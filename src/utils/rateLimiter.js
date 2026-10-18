const { redis } = require('../redis/client');
const config = require('../config');

// Returns true while the user is within the limit.
async function allow(userId) {
  const key = `ratelimit:${userId}`;
  const count = await redis.incr(key);
  // Set the window only for a newly-created counter. Avoid EXPIRE ... NX:
  // older Redis versions used by some local development containers do not
  // support its conditional form.
  if (count === 1) await redis.expire(key, config.rateLimit.windowSec);
  return count <= config.rateLimit.max;
}

module.exports = { allow };
