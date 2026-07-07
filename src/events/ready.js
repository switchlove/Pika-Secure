const sweeper = require('../scheduler/sweeper');
const logger = require('../utils/logger');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    logger.info(`Logged in as ${client.user.tag}`);
    sweeper.start(client);
  },
};
