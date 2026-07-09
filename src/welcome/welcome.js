const logger = require('../utils/logger');

const DEFAULT_MESSAGE = 'Welcome {user}! 🎉';

function renderMessage(template, member) {
  return (template || DEFAULT_MESSAGE).replaceAll('{user}', `<@${member.id}>`);
}

async function send(client, guildConfig, member) {
  if (!guildConfig.welcome_channel_id) return;
  try {
    const channel = await client.channels.fetch(guildConfig.welcome_channel_id);
    if (channel && channel.isTextBased()) {
      await channel.send({ content: renderMessage(guildConfig.welcome_message, member) });
    }
  } catch (err) {
    logger.warn('Failed to send welcome message:', err.message);
  }
}

module.exports = { send, renderMessage, DEFAULT_MESSAGE };
