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

// findExpired()/findActiveLockdowns() are unfiltered, global queries against the one SQLite file
// every process/shard shares. Under sharding, each process only owns whichever guild(s) Discord
// routed to its shard(s), so acting on a row for a guild this process doesn't own would race with
// the process that actually does own it — client.guilds.fetch() would happily succeed via REST
// regardless of shard ownership, masking the race rather than erroring. client.guilds.cache only
// contains guilds this process's shard(s) received a GUILD_CREATE for (true under both internal
// and multi-process sharding), so this is exactly "does this process own this guild". A guild the
// bot has been fully removed from isn't "owned" by anyone either, but that's fine: guildDelete.js
// already purges its pending_verifications/guild_config rows immediately on removal, so the
// sweeper skipping it here just means it was already cleaned up by that path, not left stuck.
function ownsGuild(client, guildId) {
  return client.guilds.cache.has(guildId);
}

// Mirrors flow.js's inFlightVerifications composite-key pattern (guild+user, not just guild —
// unlike raidLockdown.js's engagingGuilds/liftingGuilds, since many independent pending
// verifications can coexist per guild). Defense-in-depth: the sweeping flag in start() below
// already fully serializes sweepOnce calls within one process, so this only matters if that
// invariant ever changes; it costs nothing to keep correct now that ownsGuild() above restores
// the "one guild, one process" assumption the lock pattern relies on.
const kickingRecords = new Set();

async function sweepOnce(client) {
  const expired = findExpired();
  for (const record of expired) {
    if (!ownsGuild(client, record.guild_id)) continue;

    const lockKey = `${record.guild_id}:${record.user_id}`;
    if (kickingRecords.has(lockKey)) continue;
    kickingRecords.add(lockKey);

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
    } finally {
      kickingRecords.delete(lockKey);
    }
  }

  for (const guildConfig of findActiveLockdowns()) {
    if (!ownsGuild(client, guildConfig.guild_id)) continue;
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
