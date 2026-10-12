const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

const createClient = (name) => {
  const client = new Redis(config.redisUrl, {
    retryStrategy: (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: null,
  });
  client.on('connect', () => logger.info('redis_connected', { client: name }));
  client.on('error', (err) => logger.error('redis_error', { client: name, error: err.message }));
  return client;
};

const redis = createClient('main');
const pubClient = createClient('pub');
const subClient = pubClient.duplicate();

module.exports = { redis, pubClient, subClient };
