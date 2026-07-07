const logger = require('../utils/logger');

const BOT_ROLE_COLOR = 0xf6cf57;

module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    try {
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const botRole = me.roles.botRole;
      if (!botRole) return;
      await botRole.setColor(BOT_ROLE_COLOR);
    } catch (err) {
      logger.error(`Failed to set bot role color in guild ${guild.id}:`, err.message);
    }
  },
};
