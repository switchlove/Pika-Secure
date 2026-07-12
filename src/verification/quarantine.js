const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function assignUnverifiedRole(member, guildConfig) {
  if (!guildConfig.unverified_role_id) return;
  await member.roles.add(guildConfig.unverified_role_id);
}

async function applyVerifiedRoles(member, guildConfig) {
  if (guildConfig.unverified_role_id) {
    await member.roles.remove(guildConfig.unverified_role_id).catch(() => {});
  }
  if (guildConfig.verified_role_id) {
    await member.roles.add(guildConfig.verified_role_id).catch(() => {});
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

function buildHoneypotBaitPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🎉 Exclusive giveaway — react to enter!')
    .setDescription(
      `React with ${HONEYPOT_BAIT_EMOJI} below for a chance at a special role and prizes.`,
    );

  return { embeds: [embed] };
}

module.exports = {
  assignUnverifiedRole,
  applyVerifiedRoles,
  syncChannelPermissions,
  syncHoneypotPermissions,
  buildGateMessagePayload,
  buildHoneypotBaitPayload,
  HONEYPOT_BAIT_EMOJI,
};
