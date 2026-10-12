const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

module.exports = (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    logger.warn('auth_rejected', { reason: 'missing_token', socketId: socket.id });
    return next(new Error('Authentication required'));
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    socket.user = { id: payload.id, username: payload.username };
    next();
  } catch (err) {
    logger.warn('auth_rejected', { reason: 'invalid_token', socketId: socket.id });
    next(new Error('Invalid or expired token'));
  }
};
