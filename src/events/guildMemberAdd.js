const { handleMemberJoin } = require('../verification/flow');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  once: false,
  async execute(member) {
    try {
      await handleMemberJoin(member);
    } catch (err) {
      logger.error(`Failed to handle join for ${member.id} in guild ${member.guild.id}:`, err.message);
    }
  },
};
