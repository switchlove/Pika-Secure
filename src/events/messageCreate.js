const { getGuildConfig } = require('../database/guildConfig');
const { STAFF_EXEMPT_PERMISSIONS, triggerHoneypot } = require('../verification/honeypot');

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    if (message.author.bot || !message.guildId || !message.member) return;

    const guildConfig = getGuildConfig(message.guildId);
    if (!guildConfig.honeypot_channel_id || message.channelId !== guildConfig.honeypot_channel_id)
      return;
    if (STAFF_EXEMPT_PERMISSIONS.some((p) => message.member.permissions.has(p))) return;

    await triggerHoneypot(message.member, guildConfig, message.client, {
      channelId: message.channelId,
      trigger: 'message',
    });
  },
};
