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
  try {
    await member.ban({ reason: `Triggered honeypot channel (${meta.trigger})` });
    insertAuditLog(member.guild.id, member.id, 'honeypot_triggered', meta);
    await modlog.send(client, guildConfig, embeds.honeypotTriggeredEmbed(member, meta.trigger));
  } catch (err) {
    logger.warn(
      `Failed to ban honeypot trigger ${member.id} in guild ${member.guild.id}:`,
      err.message,
    );
  }
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
