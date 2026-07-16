const { getGuildConfig } = require('../database/guildConfig');
const { triggerHoneypot, isHoneypotChannel, isStaffExempt } = require('../verification/honeypot');
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
    if (!isHoneypotChannel(guildConfig, message.channelId)) return;

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (isStaffExempt(member)) return;

    await triggerHoneypot(member, guildConfig, message.client, {
      channelId: message.channelId,
      trigger: 'reaction',
    });
  },
};
