const logger = require('../utils/logger');

async function send(client, guildConfig, embed) {
  if (!guildConfig.mod_log_channel_id) return;
  try {
    const channel = await client.channels.fetch(guildConfig.mod_log_channel_id);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    logger.warn('Failed to send mod-log message:', err.message);
  }
}

module.exports = { send };
