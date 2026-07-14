const { RESTJSONErrorCodes } = require('discord.js');
const { findExpired, markKicked } = require('../database/pendingVerifications');
const { getGuildConfig, findActiveLockdowns } = require('../database/guildConfig');
const { insertAuditLog, pruneExpired: pruneAuditLog } = require('../database/auditLog');
const { pruneExpired: pruneRaidSignalEvents } = require('../database/raidSignalEvents');
const raidLockdown = require('../verification/raidLockdown');
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

  for (const guildConfig of findActiveLockdowns()) {
    try {
      await raidLockdown.liftIfExpired(client, guildConfig);
    } catch (err) {
      logger.error(
        `Failed to process raid lockdown lift for guild ${guildConfig.guild_id}:`,
        err.message,
      );
    }
  }

  try {
    pruneRaidSignalEvents();
  } catch (err) {
    logger.error('Tracker prune failed:', err.message);
  }

  try {
    pruneAuditLog();
  } catch (err) {
    logger.error('Audit log prune failed:', err.message);
  }
}

function start(client) {
  // Guards against a sweep that takes longer than SWEEP_INTERVAL_MS (e.g. a large flagged
  // backlog) still being in flight when the next tick fires — without this, the overlapping run
  // could re-process the same expired record before the first sweep's markKicked commits.
  let sweeping = false;
  const runSweep = (onError) => {
    if (sweeping) return;
    sweeping = true;
    sweepOnce(client)
      .catch((err) => logger.error(onError, err.message))
      .finally(() => {
        sweeping = false;
      });
  };

  runSweep('Initial sweep failed:');
  setInterval(() => runSweep('Sweep failed:'), SWEEP_INTERVAL_MS);
}

module.exports = { start };
