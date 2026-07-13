const { GuildVerificationLevel, RESTJSONErrorCodes } = require('discord.js');
const { updateGuildConfig } = require('../database/guildConfig');
const { insertAuditLog } = require('../database/auditLog');
const modlog = require('../modlog/modlog');
const embeds = require('../modlog/embeds');
const logger = require('../utils/logger');

// Last line of defense on top of per-member risk scoring/captcha escalation: when a burst of
// joins is extreme enough, temporarily raise the server's own Discord verification level (a
// free, native gate that requires little more than a phone-verified account to pass) rather than
// relying solely on the per-member gate to hold under load. Opt-in per guild — see
// raid_lockdown_join_count_threshold in guild_config, unset (null) by default.
const LOCKDOWN_VERIFICATION_LEVEL = GuildVerificationLevel.VeryHigh;

// Engages lockdown for a guild whose join-burst count just crossed the configured threshold.
// Always records the alert (audit log + mod-log), even if actually raising the verification
// level fails (e.g. the bot lacks Manage Server) — the alert itself is the primary, always-on
// signal; the verification-level change is a best-effort addition on top of it.
async function maybeEngage(guild, guildConfig, burstCount) {
  if (!guildConfig.raid_lockdown_join_count_threshold) return;
  if (guildConfig.raid_lockdown_active) return;
  if (burstCount < guildConfig.raid_lockdown_join_count_threshold) return;

  const previousLevel = guild.verificationLevel;
  let levelRaised = false;

  if (previousLevel < LOCKDOWN_VERIFICATION_LEVEL) {
    try {
      await guild.setVerificationLevel(
        LOCKDOWN_VERIFICATION_LEVEL,
        `PikaSecure: raid lockdown (${burstCount} joins crossed the configured threshold)`,
      );
      levelRaised = true;
    } catch (err) {
      logger.error(`Failed to raise verification level in guild ${guild.id}:`, err.message);
    }
  }

  const updated = updateGuildConfig(guild.id, {
    raid_lockdown_active: 1,
    raid_lockdown_expires_at: Date.now() + guildConfig.raid_lockdown_duration_minutes * 60_000,
    raid_lockdown_previous_verification_level: previousLevel,
  });

  insertAuditLog(guild.id, null, 'raid_lockdown_engaged', {
    burstCount,
    previousLevel,
    levelRaised,
  });
  await modlog.send(
    guild.client,
    updated,
    embeds.raidLockdownEngagedEmbed(burstCount, levelRaised),
  );
}

// Reverts a guild's verification level once its lockdown window has elapsed. Always clears the
// active state afterward, even if the revert API call itself fails, so a transient error can't
// leave a guild permanently stuck in "lockdown active" — that failure is still logged and
// surfaced via mod-log so an admin can revert manually.
async function liftIfExpired(client, guildConfig) {
  if (!guildConfig.raid_lockdown_active) return;
  if (Date.now() < guildConfig.raid_lockdown_expires_at) return;

  let reverted = false;
  try {
    const guild = await client.guilds.fetch(guildConfig.guild_id);
    await guild.setVerificationLevel(
      guildConfig.raid_lockdown_previous_verification_level ?? GuildVerificationLevel.None,
      'PikaSecure: raid lockdown window elapsed, reverting',
    );
    reverted = true;
  } catch (err) {
    if (err.code !== RESTJSONErrorCodes.UnknownGuild) {
      logger.error(
        `Failed to revert verification level in guild ${guildConfig.guild_id}:`,
        err.message,
      );
    }
  }

  const updated = updateGuildConfig(guildConfig.guild_id, {
    raid_lockdown_active: 0,
    raid_lockdown_expires_at: null,
    raid_lockdown_previous_verification_level: null,
  });

  insertAuditLog(guildConfig.guild_id, null, 'raid_lockdown_lifted', { reverted });
  await modlog.send(client, updated, embeds.raidLockdownLiftedEmbed(reverted));
}

module.exports = { maybeEngage, liftIfExpired, LOCKDOWN_VERIFICATION_LEVEL };
