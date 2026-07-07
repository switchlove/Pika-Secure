const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../database/guildConfig');
const { insertAuditLog } = require('../database/auditLog');
const { canManageBot, isTrueAdmin } = require('../utils/permissions');
const {
  buildGateMessagePayload,
  buildHoneypotBaitPayload,
  syncChannelPermissions,
  syncHoneypotPermissions,
  HONEYPOT_BAIT_EMOJI,
} = require('../verification/quarantine');
const logger = require('../utils/logger');

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure PikaSecure for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('roles')
      .setDescription('Set the unverified and (optionally) verified roles')
      .addRoleOption((opt) =>
        opt.setName('unverified').setDescription('Role assigned to unverified members').setRequired(true),
      )
      .addRoleOption((opt) =>
        opt.setName('verified').setDescription('Role assigned once verified (optional)').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('channels')
      .setDescription('Set the verification and mod-log channels')
      .addChannelOption((opt) =>
        opt
          .setName('verification')
          .setDescription('Channel where the verify gate is posted')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addChannelOption((opt) =>
        opt
          .setName('modlog')
          .setDescription('Channel where security events are logged')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('thresholds')
      .setDescription('Tune risk thresholds and timeouts')
      .addIntegerOption((opt) =>
        opt
          .setName('timeout_minutes')
          .setDescription('Minutes before an unverified member is auto-kicked')
          .setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('min_account_age_days')
          .setDescription('Accounts younger than this (days) are treated as riskier')
          .setMinValue(0),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('join_burst_count')
          .setDescription('Joins within the burst window that count as a raid pattern')
          .setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('join_burst_window_seconds')
          .setDescription('Length of the join-burst window, in seconds')
          .setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('captcha_risk_threshold')
          .setDescription('Risk score (0-100) at/above which captcha is required')
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('max_captcha_attempts')
          .setDescription('Failed captcha attempts allowed before flagging for review')
          .setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('hard_captcha_risk_threshold')
          .setDescription('Risk score (0-100) at/above which the harder captcha variant is used')
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('avatar_reuse_count_threshold')
          .setDescription('Times the same avatar can be seen in the reuse window before it counts as risky')
          .setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('avatar_reuse_window_seconds')
          .setDescription('Length of the avatar-reuse detection window, in seconds')
          .setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('honeypot')
      .setDescription('Set the honeypot decoy channel')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Decoy channel — anyone who posts here gets banned')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) => sub.setName('view').setDescription('View the current configuration'))
  .addSubcommandGroup((group) =>
    group
      .setName('admins')
      .setDescription('Manage which roles (beyond Manage Server) can configure PikaSecure')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Grant a role permission to run /setup (Manage Server required)')
          .addRoleOption((opt) => opt.setName('role').setDescription('Role to grant').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Revoke a role\'s permission to run /setup (Manage Server required)')
          .addRoleOption((opt) => opt.setName('role').setDescription('Role to revoke').setRequired(true)),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List roles allowed to run /setup')),
  );

const MAX_ADMIN_ROLES = 10;

function configEmbed(config) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('PikaSecure configuration')
    .addFields(
      { name: 'Unverified role', value: config.unverified_role_id ? `<@&${config.unverified_role_id}>` : 'Not set', inline: true },
      { name: 'Verified role', value: config.verified_role_id ? `<@&${config.verified_role_id}>` : 'None (just removes unverified)', inline: true },
      { name: 'Verification channel', value: config.verification_channel_id ? `<#${config.verification_channel_id}>` : 'Not set', inline: true },
      { name: 'Mod-log channel', value: config.mod_log_channel_id ? `<#${config.mod_log_channel_id}>` : 'Not set', inline: true },
      { name: 'Honeypot channel', value: config.honeypot_channel_id ? `<#${config.honeypot_channel_id}>` : 'Not set', inline: true },
      { name: 'Auto-kick timeout', value: `${config.verification_timeout_min} min`, inline: true },
      { name: 'Min account age', value: `${config.min_account_age_days} days`, inline: true },
      { name: 'Join burst threshold', value: `${config.join_burst_count_threshold} joins / ${config.join_burst_window_seconds}s`, inline: true },
      { name: 'Captcha risk threshold', value: `${config.captcha_risk_threshold}/100`, inline: true },
      { name: 'Max captcha attempts', value: `${config.max_captcha_attempts}`, inline: true },
      { name: 'Hard captcha threshold', value: `${config.hard_captcha_risk_threshold}/100`, inline: true },
      {
        name: 'Avatar reuse threshold',
        value: `${config.avatar_reuse_count_threshold} joins / ${config.avatar_reuse_window_seconds}s`,
        inline: true,
      },
      {
        name: 'Bot admin roles',
        value: config.admin_role_ids.length
          ? config.admin_role_ids.map((id) => `<@&${id}>`).join(', ')
          : 'None (Manage Server only)',
        inline: false,
      },
    );
}

function permissionWarning(failures) {
  if (!failures.length) return undefined;
  return `⚠️ Couldn't update permissions on: ${failures.join('; ')}. Check the bot's Manage Roles permission and role position.`;
}

async function execute(interaction) {
  const guildId = interaction.guild.id;
  const config = getGuildConfig(guildId);

  if (!canManageBot(interaction.member, config)) {
    return interaction.reply({
      content: 'You need the Manage Server permission or a designated PikaSecure admin role to use this.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const subGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (subGroup === 'admins') {
    if (sub === 'list') {
      return interaction.reply({ embeds: [configEmbed(config)], flags: MessageFlags.Ephemeral });
    }

    if (!isTrueAdmin(interaction.member)) {
      return interaction.reply({
        content: 'Only members with the Manage Server permission can change the admin role list.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const role = interaction.options.getRole('role');

    if (sub === 'add') {
      if (config.admin_role_ids.includes(role.id)) {
        return interaction.reply({ embeds: [configEmbed(config)], flags: MessageFlags.Ephemeral });
      }
      if (config.admin_role_ids.length >= MAX_ADMIN_ROLES) {
        return interaction.reply({
          content: `You can designate at most ${MAX_ADMIN_ROLES} admin roles.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const updated = updateGuildConfig(guildId, { admin_role_ids: [...config.admin_role_ids, role.id] });
      insertAuditLog(guildId, interaction.user.id, 'setup_changed', { admin_roles_added: role.id });
      return interaction.reply({ embeds: [configEmbed(updated)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'remove') {
      const updated = updateGuildConfig(guildId, {
        admin_role_ids: config.admin_role_ids.filter((id) => id !== role.id),
      });
      insertAuditLog(guildId, interaction.user.id, 'setup_changed', { admin_roles_removed: role.id });
      return interaction.reply({ embeds: [configEmbed(updated)], flags: MessageFlags.Ephemeral });
    }
  }

  if (sub === 'roles') {
    const unverified = interaction.options.getRole('unverified');
    const verified = interaction.options.getRole('verified');
    const updated = updateGuildConfig(guildId, {
      unverified_role_id: unverified.id,
      verified_role_id: verified ? verified.id : undefined,
    });
    insertAuditLog(guildId, interaction.user.id, 'setup_changed', {
      roles: { unverified: unverified.id, verified: verified?.id },
    });

    const failures = await syncChannelPermissions(interaction.guild, updated);
    return interaction.reply({
      content: permissionWarning(failures),
      embeds: [configEmbed(updated)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'channels') {
    const verification = interaction.options.getChannel('verification');
    const modLogChannel = interaction.options.getChannel('modlog');
    const updated = updateGuildConfig(guildId, {
      verification_channel_id: verification.id,
      mod_log_channel_id: modLogChannel.id,
    });
    insertAuditLog(guildId, interaction.user.id, 'setup_changed', {
      channels: { verification: verification.id, modlog: modLogChannel.id },
    });

    const failures = await syncChannelPermissions(interaction.guild, updated);

    try {
      const message = await verification.send(buildGateMessagePayload(updated));
      updateGuildConfig(guildId, { gate_message_id: message.id });
    } catch (err) {
      logger.error(`Failed to post gate message in guild ${guildId}:`, err.message);
    }

    return interaction.reply({
      content: permissionWarning(failures),
      embeds: [configEmbed(getGuildConfig(guildId))],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'honeypot') {
    const channel = interaction.options.getChannel('channel');
    const updated = updateGuildConfig(guildId, {
      honeypot_channel_id: channel.id,
    });
    insertAuditLog(guildId, interaction.user.id, 'setup_changed', {
      honeypot: { channel: channel.id },
    });

    const failures = await syncHoneypotPermissions(interaction.guild, updated);

    try {
      const message = await channel.send(buildHoneypotBaitPayload());
      await message.react(HONEYPOT_BAIT_EMOJI);
      updateGuildConfig(guildId, { honeypot_message_id: message.id });
    } catch (err) {
      logger.error(`Failed to post honeypot bait message in guild ${guildId}:`, err.message);
    }

    if (updated.verification_channel_id && updated.gate_message_id) {
      try {
        const verificationChannel = await interaction.guild.channels.fetch(updated.verification_channel_id);
        const gateMessage = await verificationChannel.messages.fetch(updated.gate_message_id);
        await gateMessage.edit(buildGateMessagePayload(updated));
      } catch (err) {
        logger.error(`Failed to refresh gate message in guild ${guildId}:`, err.message);
      }
    }

    return interaction.reply({
      content: permissionWarning(failures),
      embeds: [configEmbed(getGuildConfig(guildId))],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'thresholds') {
    const updated = updateGuildConfig(guildId, {
      verification_timeout_min: interaction.options.getInteger('timeout_minutes') ?? undefined,
      min_account_age_days: interaction.options.getInteger('min_account_age_days') ?? undefined,
      join_burst_count_threshold: interaction.options.getInteger('join_burst_count') ?? undefined,
      join_burst_window_seconds: interaction.options.getInteger('join_burst_window_seconds') ?? undefined,
      captcha_risk_threshold: interaction.options.getInteger('captcha_risk_threshold') ?? undefined,
      max_captcha_attempts: interaction.options.getInteger('max_captcha_attempts') ?? undefined,
      hard_captcha_risk_threshold: interaction.options.getInteger('hard_captcha_risk_threshold') ?? undefined,
      avatar_reuse_count_threshold: interaction.options.getInteger('avatar_reuse_count_threshold') ?? undefined,
      avatar_reuse_window_seconds: interaction.options.getInteger('avatar_reuse_window_seconds') ?? undefined,
    });
    insertAuditLog(guildId, interaction.user.id, 'setup_changed', { thresholds: updated });
    return interaction.reply({ embeds: [configEmbed(updated)], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'view') {
    return interaction.reply({ embeds: [configEmbed(getGuildConfig(guildId))], flags: MessageFlags.Ephemeral });
  }
}

module.exports = { data, execute };
