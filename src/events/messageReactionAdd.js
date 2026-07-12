const { getGuildConfig } = require('../database/guildConfig');
const { STAFF_EXEMPT_PERMISSIONS, triggerHoneypot } = require('../verification/honeypot');
const logger = require('../utils/logger');

module.exports = {
  name: 'messageReactionAdd',
  once: false,
  async execute(reaction, user) {
    if (user.bot) return;

    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch (err) {
      logger.warn('Failed to fetch partial honeypot reaction:', err.message);
      return;
    }

    const message = reaction.message;
    if (!message.guildId) return;

    const guildConfig = getGuildConfig(message.guildId);
    if (!guildConfig.honeypot_channel_id || message.channelId !== guildConfig.honeypot_channel_id)
      return;

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (STAFF_EXEMPT_PERMISSIONS.some((p) => member.permissions.has(p))) return;

    await triggerHoneypot(member, guildConfig, message.client, {
      channelId: message.channelId,
      trigger: 'reaction',
    });
  },
};
