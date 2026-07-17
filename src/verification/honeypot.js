const { PermissionFlagsBits } = require('discord.js');
const { insertAuditLog } = require('../database/auditLog');
const modlog = require('../modlog/modlog');
const embeds = require('../modlog/embeds');
const logger = require('../utils/logger');

const STAFF_EXEMPT_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
];

async function triggerHoneypot(member, guildConfig, client, meta) {
  let banFailed = false;
  let banError = null;

  try {
    await member.ban({ reason: `Triggered honeypot channel (${meta.trigger})` });
  } catch (err) {
    banFailed = true;
    banError = err.message;
    logger.warn(
      `Failed to ban honeypot trigger ${member.id} in guild ${member.guild.id}:`,
      err.message,
    );
  }

  // Always alert, even when the ban itself failed (e.g. missing permission or the member
  // outranks the bot) — the trigger detection is still true, and without this a raider who trips
  // the honeypot during a permission gap would stay in the server with no signal beyond a
  // console warning. Mirrors the "always alert" pattern used in raidLockdown.js.
  insertAuditLog(member.guild.id, member.id, 'honeypot_triggered', {
    ...meta,
    banFailed,
    banError,
  });
  await modlog.send(
    client,
    guildConfig,
    embeds.honeypotTriggeredEmbed(member, meta.trigger, banFailed),
  );
}

// Shared by the messageCreate and messageReactionAdd handlers, which both gate honeypot
// triggers on the same two checks.
function isHoneypotChannel(guildConfig, channelId) {
  return Boolean(guildConfig.honeypot_channel_id) && channelId === guildConfig.honeypot_channel_id;
}

function isStaffExempt(member) {
  return STAFF_EXEMPT_PERMISSIONS.some((flag) => member.permissions.has(flag));
}

module.exports = {
  STAFF_EXEMPT_PERMISSIONS,
  triggerHoneypot,
  isHoneypotChannel,
  isStaffExempt,
};
