const channelService = require('../services/channel.service');
const logger = require('../utils/logger');
const { normalizeChannel } = require('../utils/validators');
const { UserError } = require('../utils/errors');

module.exports = (io, socket, on) => {
  const user = socket.user;

  on('channel:join', async ({ channel }) => {
    const name = normalizeChannel(channel);
    if (!name) throw new UserError('Invalid channel name: use 2-30 characters (a-z, 0-9, _ or -)');
    const room = `ch:${name}`;

    if (!socket.rooms.has(room)) {
      await socket.join(room);
      const firstJoin = await channelService.join(name, user);
      if (firstJoin) socket.to(room).emit('channel:user_joined', { channel: name, user });
      io.emit('channels:updated');
      logger.transaction('channel:join', { userId: user.id, channel: name });
    }
    return {
      channel: name,
      history: await channelService.history(name),
      members: await channelService.members(name),
    };
  });

  on('channel:leave', async ({ channel }) => {
    const name = normalizeChannel(channel);
    const room = `ch:${name}`;
    if (!name || !socket.rooms.has(room)) throw new UserError('You are not in that channel');
    await socket.leave(room);
    const fullyLeft = await channelService.leave(name, user);
    if (fullyLeft) io.to(room).emit('channel:user_left', { channel: name, user });
    io.emit('channels:updated');
    logger.transaction('channel:leave', { userId: user.id, channel: name });
    return { channel: name };
  });

  on('channel:list', async () => ({ channels: await channelService.list() }));
};
