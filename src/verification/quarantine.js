const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../utils/logger');

async function assignUnverifiedRole(member, guildConfig) {
  if (!guildConfig.unverified_role_id) return;
  await member.roles.add(guildConfig.unverified_role_id);
}

// Role grants/removals here are best-effort (a missing Manage Roles permission or a deleted role
// shouldn't block the rest of verification), but a silent failure would otherwise leave a member
// marked verified and welcomed while never actually receiving the verified role, with no trace to
// debug it — so failures are logged rather than swallowed outright.
async function applyVerifiedRoles(member, guildConfig) {
  if (guildConfig.unverified_role_id) {
    await member.roles.remove(guildConfig.unverified_role_id).catch((err) => {
      logger.warn(
        `Failed to remove unverified role from ${member.id} in guild ${member.guild.id}:`,
        err.message,
      );
    });
  }
  if (guildConfig.verified_role_id) {
    await member.roles.add(guildConfig.verified_role_id).catch((err) => {
      logger.warn(
        `Failed to add verified role to ${member.id} in guild ${member.guild.id}:`,
        err.message,
      );
    });
  }
}

const BOT_CHANNEL_PERMISSIONS = {
  ViewChannel: true,
  SendMessages: true,
  EmbedLinks: true,
  AttachFiles: true,
  ManageRoles: true,
};

async function syncChannelPermissions(guild, guildConfig) {
  const failures = [];
  const roleId = guildConfig.unverified_role_id;
  if (!roleId) return failures;

  if (guildConfig.verification_channel_id) {
    try {
      const channel = await guild.channels.fetch(guildConfig.verification_channel_id);
      await channel.permissionOverwrites.edit(guild.client.user.id, BOT_CHANNEL_PERMISSIONS);
      await channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
      });
    } catch (err) {
      failures.push(
        `verification channel (<#${guildConfig.verification_channel_id}>): ${err.message}`,
      );
    }
  }

  if (guildConfig.mod_log_channel_id) {
    try {
      const channel = await guild.channels.fetch(guildConfig.mod_log_channel_id);
      await channel.permissionOverwrites.edit(guild.client.user.id, BOT_CHANNEL_PERMISSIONS);
      await channel.permissionOverwrites.edit(roleId, { ViewChannel: false });
    } catch (err) {
      failures.push(`mod-log channel (<#${guildConfig.mod_log_channel_id}>): ${err.message}`);
    }
  }

  return failures;
}

const HONEYPOT_BOT_PERMISSIONS = {
  ViewChannel: true,
  SendMessages: true,
  EmbedLinks: true,
  AttachFiles: true,
  AddReactions: true,
  BanMembers: true,
};

const HONEYPOT_BAIT_EMOJI = '🎉';

async function syncHoneypotPermissions(guild, guildConfig) {
  const failures = [];
  if (!guildConfig.honeypot_channel_id) return failures;

  try {
    const channel = await guild.channels.fetch(guildConfig.honeypot_channel_id);
    await channel.permissionOverwrites.edit(guild.client.user.id, HONEYPOT_BOT_PERMISSIONS);
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
    if (guildConfig.unverified_role_id) {
      await channel.permissionOverwrites.edit(guildConfig.unverified_role_id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AddReactions: true,
      });
    }
    if (guildConfig.verified_role_id) {
      await channel.permissionOverwrites.edit(guildConfig.verified_role_id, { ViewChannel: false });
    }
  } catch (err) {
    failures.push(`honeypot channel (<#${guildConfig.honeypot_channel_id}>): ${err.message}`);
  }

  return failures;
}

// Best-effort revoke of the unverified role's standing ViewChannel access to a channel that used
// to be the configured verification channel but no longer is (e.g. /setup channels pointed at a
// different channel) — without this, unverified members can still see the old gate channel after
// reconfiguration. Explicit deny, matching syncChannelPermissions' own mod-log-channel convention.
async function revokeVerificationChannelPermissions(guild, channelId, unverifiedRoleId) {
  const failures = [];
  if (!channelId || !unverifiedRoleId) return failures;

  try {
    const channel = await guild.channels.fetch(channelId);
    await channel.permissionOverwrites.edit(unverifiedRoleId, { ViewChannel: false });
  } catch (err) {
    failures.push(`old verification channel (<#${channelId}>): ${err.message}`);
  }

  return failures;
}

// Best-effort revoke of the unverified role's standing access to a channel that used to be the
// configured honeypot but no longer is (e.g. /setup honeypot pointed at a different channel) —
// without this, the old channel stays visible/writable to unverified members while no longer
// being monitored, i.e. a disarmed trap that still looks armed. Explicit deny (not
// permissionOverwrites.delete()) to match syncChannelPermissions' existing convention: deleting
// the overwrite could fall back to a more permissive category/@everyone permission.
async function revokeHoneypotPermissions(guild, channelId, unverifiedRoleId) {
  const failures = [];
  if (!channelId || !unverifiedRoleId) return failures;

  try {
    const channel = await guild.channels.fetch(channelId);
    await channel.permissionOverwrites.edit(unverifiedRoleId, {
      ViewChannel: false,
      SendMessages: false,
      AddReactions: false,
    });
  } catch (err) {
    failures.push(`old honeypot channel (<#${channelId}>): ${err.message}`);
  }

  return failures;
}

// Edits the existing gate message in place rather than posting a new one — used whenever the
// verification channel isn't changing, so re-running /setup doesn't leave duplicate "Verify"
// buttons behind. Returns false (rather than throwing) on any failure — missing channel, deleted
// message, missing permission — so callers can fall back to posting a fresh message instead.
async function refreshGateMessage(guild, guildConfig) {
  if (!guildConfig.verification_channel_id || !guildConfig.gate_message_id) return false;
  try {
    const channel = await guild.channels.fetch(guildConfig.verification_channel_id);
    const message = await channel.messages.fetch(guildConfig.gate_message_id);
    await message.edit(buildGateMessagePayload(guildConfig));
    return true;
  } catch {
    return false;
  }
}

function buildGateMessagePayload(guildConfig) {
  const description = [];

  if (guildConfig?.honeypot_channel_id) {
    description.push(
      `⚠️ **Do not post in or react to anything in <#${guildConfig.honeypot_channel_id}>.** ⚠️\nIt's a decoy channel monitored for bots — interacting with it in any way results in an instant ban.`,
    );
  }

  description.push(
    'Click **Verify** below to gain access to the server. Some accounts may be asked to solve a quick captcha.',
  );

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Verification required')
    .setDescription(description.join('\n\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:start')
      .setLabel('Verify')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}

const DEFAULT_HONEYPOT_BAIT_MESSAGE = `React with ${HONEYPOT_BAIT_EMOJI} below for a chance at a special role and prizes.`;

// The bait text is fixed by default across every deployment of this (open-source) bot, which
// makes it a fingerprintable tell for anyone who's read the source — letting admins override it
// per guild means a raid operator can no longer assume "the giveaway embed = the honeypot".
function buildHoneypotBaitPayload(guildConfig) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🎉 Exclusive giveaway — react to enter!')
    .setDescription(guildConfig?.honeypot_bait_message || DEFAULT_HONEYPOT_BAIT_MESSAGE);

  return { embeds: [embed] };
}

module.exports = {
  assignUnverifiedRole,
  applyVerifiedRoles,
  syncChannelPermissions,
  syncHoneypotPermissions,
  revokeVerificationChannelPermissions,
  revokeHoneypotPermissions,
  refreshGateMessage,
  buildGateMessagePayload,
  buildHoneypotBaitPayload,
  HONEYPOT_BAIT_EMOJI,
  DEFAULT_HONEYPOT_BAIT_MESSAGE,
};
