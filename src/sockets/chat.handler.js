const crypto = require('crypto');
const channelService = require('../services/channel.service');
const logger = require('../utils/logger');
const config = require('../config');
const { normalizeChannel, cleanText, isUserId } = require('../utils/validators');
const { UserError } = require('../utils/errors');

module.exports = (io, socket, on) => {
  const user = socket.user;
  const lengthError = `Message must be 1-${config.maxMessageLength} characters`;

  on(
    'message:send',
    async ({ channel, text }) => {
      const name = normalizeChannel(channel);
      const body = cleanText(text);
      if (!name) throw new UserError('Invalid channel name');
      if (!body) throw new UserError(lengthError);
      const room = `ch:${name}`;
      if (!socket.rooms.has(room)) throw new UserError('Join the channel before sending messages');

      const message = await channelService.saveMessage(name, user, body);
      io.to(room).emit('message:new', message);
      logger.transaction('message:send', {
        messageId: message.id,
        userId: user.id,
        channel: name,
        size: body.length,
        sentAt: message.ts,
      });
      return { message };
    },
    { limited: true }
  );

  on(
    'message:private',
    async ({ to, text }) => {
      const body = cleanText(text);
      if (!isUserId(to)) throw new UserError('Invalid recipient');
      if (to === user.id) throw new UserError('You cannot message yourself');
      if (!body) throw new UserError(lengthError);

      const recipients = await io.in(`user:${to}`).fetchSockets();
      if (recipients.length === 0) throw new UserError('That user is offline');

      const message = {
        id: crypto.randomUUID(),
        from: user,
        to,
        text: body,
        ts: new Date().toISOString(),
      };
      io.to(`user:${to}`).to(`user:${user.id}`).emit('message:private', message);
      logger.transaction('message:private', { messageId: message.id, from: user.id, to, size: body.length });
      return { message };
    },
    { limited: true }
  );

  const typing = (isTyping) => async ({ channel }) => {
    const name = normalizeChannel(channel);
    if (name && socket.rooms.has(`ch:${name}`)) {
      socket.to(`ch:${name}`).emit('typing', { channel: name, user, typing: isTyping });
    }
    return {};
  };
  on('typing:start', typing(true));
  on('typing:stop', typing(false));
};
