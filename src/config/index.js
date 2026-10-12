require('dotenv').config();

const num = (v, d) => (v === undefined ? d : Number(v));

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing in .env');
  process.exit(1);
}

module.exports = {
  port: num(process.env.PORT, 3000),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET,
  logDir: process.env.LOG_DIR || './logs',
  rateLimit: {
    max: num(process.env.RATE_LIMIT_MAX, 10),
    windowSec: num(process.env.RATE_LIMIT_WINDOW_SEC, 5),
  },
  historyLimit: num(process.env.HISTORY_LIMIT, 50),
  maxMessageLength: num(process.env.MAX_MESSAGE_LENGTH, 1000),
  presenceTtlSec: num(process.env.PRESENCE_TTL_SEC, 60),
};
