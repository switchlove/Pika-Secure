const db = require('../database/db');
const { deleteGuildConfig } = require('../database/guildConfig');
const {
  deleteAllForGuild: deletePendingVerifications,
} = require('../database/pendingVerifications');
const { deleteAllForGuild: deleteAuditLog } = require('../database/auditLog');
const { deleteAllForGuild: deleteRaidSignalEvents } = require('../database/raidSignalEvents');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildDelete',
  once: false,
  async execute(guild) {
    // `guildDelete` also fires when a guild becomes temporarily unavailable during a Discord
    // outage (guild.available === false in that case) — only purge stored data when the bot has
    // actually been removed from a guild that's still up, not during an outage blip.
    if (!guild.available) return;

    try {
      db.exec('BEGIN');
      try {
        deletePendingVerifications(guild.id);
        deleteAuditLog(guild.id);
        deleteRaidSignalEvents(guild.id);
        deleteGuildConfig(guild.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      logger.info(`Purged stored data for guild ${guild.id} (bot removed from guild).`);
    } catch (err) {
      logger.error(`Failed to purge data for guild ${guild.id}:`, err.message);
    }
  },
};
