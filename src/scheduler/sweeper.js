const { RESTJSONErrorCodes } = require('discord.js');
const { findExpired, markKicked } = require('../database/pendingVerifications');
const { getGuildConfig } = require('../database/guildConfig');
const { insertAuditLog } = require('../database/auditLog');
const { pruneExpired } = require('../database/raidSignalEvents');
const modlog = require('../modlog/modlog');
const embeds = require('../modlog/embeds');
const logger = require('../utils/logger');

const SWEEP_INTERVAL_MS = 60_000;

async function sweepOnce(client) {
  const expired = findExpired();
  for (const record of expired) {
    try {
      let guild;
      try {
        guild = await client.guilds.fetch(record.guild_id);
      } catch (err) {
        if (err.code === RESTJSONErrorCodes.UnknownGuild) {
          markKicked(record.id);
          insertAuditLog(record.guild_id, record.user_id, 'auto_kicked');
          continue;
        }
        throw err;
      }

      const member = await guild.members.fetch(record.user_id).catch(() => null);
      if (member) {
        await member.kick('Verification window expired');
      }

      markKicked(record.id);
      insertAuditLog(record.guild_id, record.user_id, 'auto_kicked');

      const guildConfig = getGuildConfig(record.guild_id);
      await modlog.send(
        client,
        guildConfig,
        embeds.autoKickedEmbed(record.guild_id, record.user_id),
      );
    } catch (err) {
      logger.error(`Sweeper failed to process ${record.guild_id}/${record.user_id}:`, err.message);
    }
  }

  try {
    pruneExpired();
  } catch (err) {
    logger.error('Tracker prune failed:', err.message);
  }
}

function start(client) {
  sweepOnce(client).catch((err) => logger.error('Initial sweep failed:', err.message));
  setInterval(() => {
    sweepOnce(client).catch((err) => logger.error('Sweep failed:', err.message));
  }, SWEEP_INTERVAL_MS);
}

module.exports = { start };
