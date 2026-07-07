const { findExpired, markKicked } = require('../database/pendingVerifications');
const { getGuildConfig } = require('../database/guildConfig');
const { insertAuditLog } = require('../database/auditLog');
const modlog = require('../modlog/modlog');
const embeds = require('../modlog/embeds');
const logger = require('../utils/logger');

const SWEEP_INTERVAL_MS = 60_000;

async function sweepOnce(client) {
  const expired = findExpired();
  for (const record of expired) {
    try {
      const guild = await client.guilds.fetch(record.guild_id);
      const member = await guild.members.fetch(record.user_id).catch(() => null);
      if (member) {
        await member.kick('Verification window expired');
      }

      markKicked(record.id);
      insertAuditLog(record.guild_id, record.user_id, 'auto_kicked');

      const guildConfig = getGuildConfig(record.guild_id);
      await modlog.send(client, guildConfig, embeds.autoKickedEmbed(record.guild_id, record.user_id));
    } catch (err) {
      logger.error(`Sweeper failed to process ${record.guild_id}/${record.user_id}:`, err.message);
    }
  }
}

function start(client) {
  sweepOnce(client).catch((err) => logger.error('Initial sweep failed:', err.message));
  setInterval(() => {
    sweepOnce(client).catch((err) => logger.error('Sweep failed:', err.message));
  }, SWEEP_INTERVAL_MS);
}

module.exports = { start };
