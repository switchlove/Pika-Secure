const { getGuildConfig } = require('../database/guildConfig');
const { triggerHoneypot, isHoneypotChannel, isStaffExempt } = require('../verification/honeypot');

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    if (message.author.bot || !message.guildId || !message.member) return;

    const guildConfig = getGuildConfig(message.guildId);
    if (!isHoneypotChannel(guildConfig, message.channelId)) return;
    if (isStaffExempt(message.member)) return;

    await triggerHoneypot(message.member, guildConfig, message.client, {
      channelId: message.channelId,
      trigger: 'message',
    });
  },
};
