const presence = require('../services/presence.service');
const channelService = require('../services/channel.service');
const rateLimiter = require('../utils/rateLimiter');
const logger = require('../utils/logger');
const config = require('../config');
const { UserError } = require('../utils/errors');
const registerChannelHandlers = require('./channel.handler');
const registerChatHandlers = require('./chat.handler');

module.exports = (io) => {
  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`user:${user.id}`); // personal room: private messages, multi-tab

    const on = (event, fn, { limited = false } = {}) => {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          if (limited && !(await rateLimiter.allow(user.id))) {
            logger.transaction('rate_limited', { userId: user.id, event });
            return reply({ ok: false, error: 'Too many messages, slow down' });
          }
          const result = await fn(payload && typeof payload === 'object' ? payload : {});
          reply({ ok: true, ...result });
        } catch (err) {
          if (err instanceof UserError) return reply({ ok: false, error: err.message });
          logger.error('handler_error', { event, userId: user.id, error: err.message });
          reply({ ok: false, error: 'Internal server error' });
        }
      });
    };

    // Register handlers first so no early client event is missed.
    registerChannelHandlers(io, socket, on);
    registerChatHandlers(io, socket, on);
    on('presence:list', async () => ({ users: await presence.listOnline() }));

    // Presence: mark online and keep the heartbeat alive.
    presence
      .connect(user, socket.id)
      .then((cameOnline) => {
        logger.transaction('connect', { userId: user.id, socketId: socket.id });
        if (cameOnline) socket.broadcast.emit('presence:update', { user, online: true });
      })
      .catch((err) => logger.error('presence_connect_failed', { error: err.message }));

    const heartbeat = setInterval(
      () => presence.heartbeat(user).catch(() => {}),
      (config.presenceTtlSec / 3) * 1000
    );

    // 'disconnecting' fires while socket.rooms is still populated.
    socket.on('disconnecting', async (reason) => {
      clearInterval(heartbeat);
      try {
        const rooms = [...socket.rooms].filter((r) => r.startsWith('ch:'));
        for (const room of rooms) {
          const channel = room.slice(3);
          const fullyLeft = await channelService.leave(channel, user);
          if (fullyLeft) socket.to(room).emit('channel:user_left', { channel, user });
        }
        const wentOffline = await presence.disconnect(user, socket.id);
        if (wentOffline) socket.broadcast.emit('presence:update', { user, online: false });
        io.emit('channels:updated');
        logger.transaction('disconnect', { userId: user.id, socketId: socket.id, reason });
      } catch (err) {
        logger.error('disconnect_cleanup_failed', { userId: user.id, error: err.message });
      }
    });
  });
};
