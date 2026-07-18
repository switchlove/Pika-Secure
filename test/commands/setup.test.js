import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { GuildVerificationLevel } from 'discord.js';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let guildConfigMod;
let auditLog;
let pendingVerifications;
let permissions;
let quarantine;
let logger;
let setup;

const GATE_PAYLOAD = { sentinel: 'gate-payload' };
const BAIT_PAYLOAD = { sentinel: 'bait-payload' };
const FLAGGED_LIST_EMBED = { sentinel: 'flagged-list' };
const AUDIT_LOG_LIST_EMBED = { sentinel: 'audit-log-list' };

function baseConfig(overrides = {}) {
  return {
    guild_id: 'guild-1',
    unverified_role_id: null,
    verified_role_id: null,
    verification_channel_id: null,
    mod_log_channel_id: null,
    honeypot_channel_id: null,
    honeypot_message_id: null,
    honeypot_bait_message: null,
    gate_message_id: null,
    verification_timeout_min: 15,
    min_account_age_days: 7,
    join_burst_count_threshold: 5,
    join_burst_window_seconds: 60,
    captcha_risk_threshold: 50,
    max_captcha_attempts: 3,
    avatar_reuse_count_threshold: 3,
    avatar_reuse_window_seconds: 300,
    hard_captcha_risk_threshold: 75,
    perceptual_avatar_hamming_threshold: 10,
    username_similarity_count_threshold: 3,
    username_similarity_window_seconds: 300,
    username_similarity_distance_threshold: 2,
    fast_solve_count_threshold: 3,
    fast_solve_window_seconds: 300,
    captcha_type: 'image',
    admin_role_ids: [],
    raid_lockdown_join_count_threshold: null,
    raid_lockdown_duration_minutes: 30,
    raid_lockdown_active: 0,
    raid_lockdown_expires_at: null,
    raid_lockdown_previous_verification_level: null,
    ...overrides,
  };
}

beforeEach(() => {
  bustSrcRequireCache(require);

  guildConfigMod = injectFakeModule(require, '../../src/database/guildConfig.js', {
    getGuildConfig: vi.fn().mockReturnValue(baseConfig()),
    updateGuildConfig: vi.fn().mockReturnValue(baseConfig()),
  });

  auditLog = injectFakeModule(require, '../../src/database/auditLog.js', {
    insertAuditLog: vi.fn(),
    queryAuditLog: vi.fn().mockReturnValue([]),
  });

  pendingVerifications = injectFakeModule(require, '../../src/database/pendingVerifications.js', {
    findFlagged: vi.fn().mockReturnValue([]),
  });

  injectFakeModule(require, '../../src/database/raidSignalEvents.js', {
    MAX_DETECTION_WINDOW_SECONDS: 82800,
  });

  injectFakeModule(require, '../../src/modlog/embeds.js', {
    flaggedListEmbed: vi.fn().mockReturnValue(FLAGGED_LIST_EMBED),
    auditLogListEmbed: vi.fn().mockReturnValue(AUDIT_LOG_LIST_EMBED),
  });

  permissions = injectFakeModule(require, '../../src/utils/permissions.js', {
    canManageBot: vi.fn().mockReturnValue(true),
    isTrueAdmin: vi.fn().mockReturnValue(true),
  });

  quarantine = injectFakeModule(require, '../../src/verification/quarantine.js', {
    buildGateMessagePayload: vi.fn().mockReturnValue(GATE_PAYLOAD),
    buildHoneypotBaitPayload: vi.fn().mockReturnValue(BAIT_PAYLOAD),
    syncChannelPermissions: vi.fn().mockResolvedValue([]),
    syncHoneypotPermissions: vi.fn().mockResolvedValue([]),
    revokeVerificationChannelPermissions: vi.fn().mockResolvedValue([]),
    revokeHoneypotPermissions: vi.fn().mockResolvedValue([]),
    refreshGateMessage: vi.fn().mockResolvedValue(false),
    HONEYPOT_BAIT_EMOJI: '🎉',
    DEFAULT_HONEYPOT_BAIT_MESSAGE: 'React with 🎉 below for a chance at a special role and prizes.',
  });

  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });

  setup = require('../../src/commands/setup.js');
});

function makeInteraction({
  subGroup = null,
  sub,
  roleOptions = {},
  channelOptions = {},
  integerOptions = {},
  stringOptions = {},
  userOptions = {},
  verificationLevel = GuildVerificationLevel.Medium,
} = {}) {
  return {
    guild: { id: 'guild-1', channels: { fetch: vi.fn() }, verificationLevel },
    member: { id: 'admin-member' },
    user: { id: 'admin-user' },
    options: {
      getSubcommandGroup: vi.fn(() => subGroup),
      getSubcommand: vi.fn(() => sub),
      getRole: vi.fn((name) => roleOptions[name]),
      getChannel: vi.fn((name) => channelOptions[name]),
      getInteger: vi.fn((name) => (name in integerOptions ? integerOptions[name] : null)),
      getString: vi.fn((name) => (name in stringOptions ? stringOptions[name] : null)),
      getUser: vi.fn((name) => userOptions[name]),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('data', () => {
  it('is named "setup"', () => {
    expect(setup.data.name).toBe('setup');
  });

  it('caps the four detection-window threshold options at MAX_DETECTION_WINDOW_SECONDS', () => {
    const thresholds = setup.data.toJSON().options.find((opt) => opt.name === 'thresholds');
    const windowOptionNames = [
      'join_burst_window_seconds',
      'avatar_reuse_window_seconds',
      'username_similarity_window',
      'fast_solve_window_seconds',
    ];
    for (const name of windowOptionNames) {
      const option = thresholds.options.find((opt) => opt.name === name);
      expect(option.max_value).toBe(82800);
    }
  });
});

describe('execute — permission gate', () => {
  it('rejects when the member cannot manage the bot', async () => {
    permissions.canManageBot.mockReturnValue(false);
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Manage Server') }),
    );
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });
});

describe('execute — admins group', () => {
  it('lists admin roles without requiring isTrueAdmin', async () => {
    permissions.isTrueAdmin.mockReturnValue(false);
    const interaction = makeInteraction({ subGroup: 'admins', sub: 'list' });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('rejects add/remove when the member is not a true admin', async () => {
    permissions.isTrueAdmin.mockReturnValue(false);
    const interaction = makeInteraction({
      subGroup: 'admins',
      sub: 'add',
      roleOptions: { role: { id: 'role-x' } },
    });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Manage Server permission') }),
    );
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('no-ops when adding a role that is already an admin role', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ admin_role_ids: ['role-x'] }));
    const interaction = makeInteraction({
      subGroup: 'admins',
      sub: 'add',
      roleOptions: { role: { id: 'role-x' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('rejects adding a role beyond the 10-role cap', async () => {
    const tenRoles = Array.from({ length: 10 }, (_, i) => `role-${i}`);
    guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ admin_role_ids: tenRoles }));
    const interaction = makeInteraction({
      subGroup: 'admins',
      sub: 'add',
      roleOptions: { role: { id: 'role-new' } },
    });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('at most 10') }),
    );
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('adds a new admin role', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ admin_role_ids: ['role-existing'] }),
    );
    const interaction = makeInteraction({
      subGroup: 'admins',
      sub: 'add',
      roleOptions: { role: { id: 'role-new' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      admin_role_ids: ['role-existing', 'role-new'],
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      admin_roles_added: 'role-new',
    });
  });

  it('removes an admin role', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ admin_role_ids: ['role-a', 'role-b'] }),
    );
    const interaction = makeInteraction({
      subGroup: 'admins',
      sub: 'remove',
      roleOptions: { role: { id: 'role-a' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      admin_role_ids: ['role-b'],
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      admin_roles_removed: 'role-a',
    });
  });

  it('no-ops when removing a role that is not an admin role', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ admin_role_ids: ['role-a'] }));
    const interaction = makeInteraction({
      subGroup: 'admins',
      sub: 'remove',
      roleOptions: { role: { id: 'role-not-admin' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
    expect(auditLog.insertAuditLog).not.toHaveBeenCalled();
  });
});

describe('execute — roles', () => {
  it('sets unverified and verified roles and syncs permissions', async () => {
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ unverified_role_id: 'role-u', verified_role_id: 'role-v' }),
    );
    const interaction = makeInteraction({
      sub: 'roles',
      roleOptions: { unverified: { id: 'role-u' }, verified: { id: 'role-v' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      unverified_role_id: 'role-u',
      verified_role_id: 'role-v',
    });
    expect(quarantine.syncChannelPermissions).toHaveBeenCalledWith(
      interaction.guild,
      expect.any(Object),
    );
    expect(quarantine.syncHoneypotPermissions).toHaveBeenCalledWith(
      interaction.guild,
      expect.any(Object),
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: undefined, embeds: expect.any(Array) }),
    );
  });

  it('merges failures from both channel and honeypot permission syncs', async () => {
    quarantine.syncChannelPermissions.mockResolvedValue(['verification channel (<#x>): no access']);
    quarantine.syncHoneypotPermissions.mockResolvedValue(['honeypot channel (<#y>): no access']);
    const interaction = makeInteraction({
      sub: 'roles',
      roleOptions: { unverified: { id: 'role-u' } },
    });

    await setup.execute(interaction);

    const content = interaction.reply.mock.calls[0][0].content;
    expect(content).toContain('verification channel (<#x>): no access');
    expect(content).toContain('honeypot channel (<#y>): no access');
  });

  it('passes verified_role_id as undefined when the optional role is omitted', async () => {
    const interaction = makeInteraction({
      sub: 'roles',
      roleOptions: { unverified: { id: 'role-u' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      unverified_role_id: 'role-u',
      verified_role_id: undefined,
    });
  });

  it('surfaces a permission warning when syncChannelPermissions reports failures', async () => {
    quarantine.syncChannelPermissions.mockResolvedValue(['verification channel (<#x>): no access']);
    const interaction = makeInteraction({
      sub: 'roles',
      roleOptions: { unverified: { id: 'role-u' } },
    });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Couldn't update permissions") }),
    );
  });
});

describe('execute — channels', () => {
  it('rejects when verification and mod-log are set to the same channel', async () => {
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: { id: 'chan-same' }, modlog: { id: 'chan-same' } },
    });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('must be different') }),
    );
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
    expect(quarantine.syncChannelPermissions).not.toHaveBeenCalled();
  });

  it('sets channels, syncs permissions, and posts the gate message when the channel changed', async () => {
    const updatedConfig = baseConfig({
      verification_channel_id: 'chan-v',
      mod_log_channel_id: 'chan-m',
    });
    guildConfigMod.updateGuildConfig.mockReturnValue(updatedConfig);
    const gateMessage = { id: 'gate-msg-1' };
    const verificationChannel = { id: 'chan-v', send: vi.fn().mockResolvedValue(gateMessage) };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(1, 'guild-1', {
      verification_channel_id: 'chan-v',
      mod_log_channel_id: 'chan-m',
    });
    expect(quarantine.refreshGateMessage).not.toHaveBeenCalled();
    expect(verificationChannel.send).toHaveBeenCalledWith(GATE_PAYLOAD);
    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(2, 'guild-1', {
      gate_message_id: 'gate-msg-1',
    });
    expect(guildConfigMod.getGuildConfig).toHaveBeenCalledTimes(2);
  });

  it('still replies successfully when posting the gate message fails', async () => {
    const verificationChannel = {
      id: 'chan-v',
      send: vi.fn().mockRejectedValue(new Error('no perms')),
    };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(logger.error).toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('edits the existing gate message in place instead of posting a new one when the verification channel is unchanged', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-v', gate_message_id: 'gate-old' }),
    );
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-v', mod_log_channel_id: 'chan-m' }),
    );
    quarantine.refreshGateMessage.mockResolvedValue(true);
    const verificationChannel = { id: 'chan-v', send: vi.fn() };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(quarantine.refreshGateMessage).toHaveBeenCalledWith(
      interaction.guild,
      expect.any(Object),
    );
    expect(verificationChannel.send).not.toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledTimes(1);
  });

  it('deletes the old gate message and posts a new one when the verification channel changes', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-old', gate_message_id: 'gate-old' }),
    );
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-v', mod_log_channel_id: 'chan-m' }),
    );
    const oldMessage = { delete: vi.fn().mockResolvedValue(undefined) };
    const oldChannel = { messages: { fetch: vi.fn().mockResolvedValue(oldMessage) } };
    const verificationChannel = {
      id: 'chan-v',
      send: vi.fn().mockResolvedValue({ id: 'gate-new' }),
    };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });
    interaction.guild.channels.fetch.mockResolvedValue(oldChannel);

    await setup.execute(interaction);

    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('chan-old');
    expect(oldChannel.messages.fetch).toHaveBeenCalledWith('gate-old');
    expect(oldMessage.delete).toHaveBeenCalled();
    expect(quarantine.refreshGateMessage).not.toHaveBeenCalled();
    expect(verificationChannel.send).toHaveBeenCalledWith(GATE_PAYLOAD);
  });

  it('logs and still posts a new gate message when deleting the old one fails', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-old', gate_message_id: 'gate-old' }),
    );
    const verificationChannel = {
      id: 'chan-v',
      send: vi.fn().mockResolvedValue({ id: 'gate-new' }),
    };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });
    interaction.guild.channels.fetch.mockRejectedValue(new Error('old channel gone'));

    await setup.execute(interaction);

    expect(logger.warn).toHaveBeenCalled();
    expect(verificationChannel.send).toHaveBeenCalledWith(GATE_PAYLOAD);
  });

  it('falls back to posting a new gate message when refreshGateMessage reports failure', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-v', gate_message_id: 'gate-old' }),
    );
    quarantine.refreshGateMessage.mockResolvedValue(false);
    const verificationChannel = {
      id: 'chan-v',
      send: vi.fn().mockResolvedValue({ id: 'gate-new' }),
    };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(quarantine.refreshGateMessage).toHaveBeenCalled();
    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
    expect(verificationChannel.send).toHaveBeenCalledWith(GATE_PAYLOAD);
  });

  it('revokes the old verification channel permissions when the channel changes', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-old', unverified_role_id: 'role-u' }),
    );
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-v', unverified_role_id: 'role-u' }),
    );
    const verificationChannel = {
      id: 'chan-v',
      send: vi.fn().mockResolvedValue({ id: 'gate-new' }),
    };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(quarantine.revokeVerificationChannelPermissions).toHaveBeenCalledWith(
      interaction.guild,
      'chan-old',
      'role-u',
    );
  });

  it('does not revoke old verification channel permissions when the channel is unchanged', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-v', unverified_role_id: 'role-u' }),
    );
    const verificationChannel = { id: 'chan-v', send: vi.fn() };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(quarantine.revokeVerificationChannelPermissions).not.toHaveBeenCalled();
  });

  it('surfaces verification-channel revoke failures in the permission warning', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-old' }),
    );
    quarantine.revokeVerificationChannelPermissions.mockResolvedValue([
      'old verification channel (<#chan-old>): missing perms',
    ]);
    const verificationChannel = {
      id: 'chan-v',
      send: vi.fn().mockResolvedValue({ id: 'gate-new' }),
    };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('old verification channel (<#chan-old>): missing perms'),
      }),
    );
  });
});

describe('execute — welcome', () => {
  it('sets the welcome channel and custom message', async () => {
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ welcome_channel_id: 'chan-w', welcome_message: 'Hi {user}!' }),
    );
    const interaction = makeInteraction({
      sub: 'welcome',
      channelOptions: { channel: { id: 'chan-w' } },
      stringOptions: { message: 'Hi {user}!' },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      welcome_channel_id: 'chan-w',
      welcome_message: 'Hi {user}!',
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      welcome: { channel: 'chan-w', message: 'Hi {user}!' },
    });
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('passes welcome_message as undefined when the optional message is omitted', async () => {
    const interaction = makeInteraction({
      sub: 'welcome',
      channelOptions: { channel: { id: 'chan-w' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      welcome_channel_id: 'chan-w',
      welcome_message: undefined,
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      welcome: { channel: 'chan-w', message: undefined },
    });
  });
});

describe('execute — honeypot', () => {
  it('sets the honeypot channel, syncs permissions, and posts/reacts to the bait message', async () => {
    const baitMessage = { id: 'bait-msg-1', react: vi.fn().mockResolvedValue(undefined) };
    const honeypotChannel = { id: 'chan-h', send: vi.fn().mockResolvedValue(baitMessage) };
    guildConfigMod.updateGuildConfig.mockReturnValue(baseConfig({ honeypot_channel_id: 'chan-h' }));
    const interaction = makeInteraction({
      sub: 'honeypot',
      channelOptions: { channel: honeypotChannel },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(1, 'guild-1', {
      honeypot_channel_id: 'chan-h',
      honeypot_bait_message: undefined,
    });
    expect(quarantine.syncHoneypotPermissions).toHaveBeenCalledWith(
      interaction.guild,
      expect.any(Object),
    );
    expect(quarantine.buildHoneypotBaitPayload).toHaveBeenCalledWith(expect.any(Object));
    expect(honeypotChannel.send).toHaveBeenCalledWith(BAIT_PAYLOAD);
    expect(baitMessage.react).toHaveBeenCalledWith('🎉');
    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(2, 'guild-1', {
      honeypot_message_id: 'bait-msg-1',
    });
  });

  it('passes a custom bait message through to updateGuildConfig and the audit log', async () => {
    const baitMessage = { id: 'bait-msg-1', react: vi.fn().mockResolvedValue(undefined) };
    const honeypotChannel = { id: 'chan-h', send: vi.fn().mockResolvedValue(baitMessage) };
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ honeypot_channel_id: 'chan-h', honeypot_bait_message: 'Custom bait text' }),
    );
    const interaction = makeInteraction({
      sub: 'honeypot',
      channelOptions: { channel: honeypotChannel },
      stringOptions: { message: 'Custom bait text' },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(1, 'guild-1', {
      honeypot_channel_id: 'chan-h',
      honeypot_bait_message: 'Custom bait text',
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      honeypot: { channel: 'chan-h', message: 'Custom bait text' },
    });
  });

  it('still replies successfully when posting the bait message fails', async () => {
    const honeypotChannel = {
      id: 'chan-h',
      send: vi.fn().mockRejectedValue(new Error('no perms')),
    };
    const interaction = makeInteraction({
      sub: 'honeypot',
      channelOptions: { channel: honeypotChannel },
    });

    await setup.execute(interaction);

    expect(logger.error).toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('refreshes the gate message via refreshGateMessage after posting the bait message', async () => {
    const updated = baseConfig({
      honeypot_channel_id: 'chan-h',
      verification_channel_id: 'chan-v',
      gate_message_id: 'gate-1',
    });
    guildConfigMod.updateGuildConfig.mockReturnValue(updated);
    const honeypotChannel = {
      id: 'chan-h',
      send: vi.fn().mockResolvedValue({ id: 'm', react: vi.fn().mockResolvedValue() }),
    };
    const interaction = makeInteraction({
      sub: 'honeypot',
      channelOptions: { channel: honeypotChannel },
    });

    await setup.execute(interaction);

    expect(quarantine.refreshGateMessage).toHaveBeenCalledWith(interaction.guild, updated);
  });

  it('revokes the old honeypot channel permissions when the channel changes', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ honeypot_channel_id: 'chan-old', unverified_role_id: 'role-u' }),
    );
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ honeypot_channel_id: 'chan-h', unverified_role_id: 'role-u' }),
    );
    quarantine.revokeHoneypotPermissions.mockResolvedValue([]);
    const honeypotChannel = {
      id: 'chan-h',
      send: vi.fn().mockResolvedValue({ id: 'm', react: vi.fn().mockResolvedValue() }),
    };
    const interaction = makeInteraction({
      sub: 'honeypot',
      channelOptions: { channel: honeypotChannel },
    });

    await setup.execute(interaction);

    expect(quarantine.revokeHoneypotPermissions).toHaveBeenCalledWith(
      interaction.guild,
      'chan-old',
      'role-u',
    );
  });

  it('does not revoke old honeypot permissions when the channel is unchanged', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ honeypot_channel_id: 'chan-h' }));
    guildConfigMod.updateGuildConfig.mockReturnValue(baseConfig({ honeypot_channel_id: 'chan-h' }));
    const honeypotChannel = {
      id: 'chan-h',
      send: vi.fn().mockResolvedValue({ id: 'm', react: vi.fn().mockResolvedValue() }),
    };
    const interaction = makeInteraction({
      sub: 'honeypot',
      channelOptions: { channel: honeypotChannel },
    });

    await setup.execute(interaction);

    expect(quarantine.revokeHoneypotPermissions).not.toHaveBeenCalled();
  });

  it('surfaces revoke failures in the permission warning alongside sync failures', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ honeypot_channel_id: 'chan-old' }));
    quarantine.revokeHoneypotPermissions.mockResolvedValue([
      'old honeypot channel (<#chan-old>): missing perms',
    ]);
    const honeypotChannel = {
      id: 'chan-h',
      send: vi.fn().mockResolvedValue({ id: 'm', react: vi.fn().mockResolvedValue() }),
    };
    const interaction = makeInteraction({
      sub: 'honeypot',
      channelOptions: { channel: honeypotChannel },
    });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('old honeypot channel (<#chan-old>): missing perms'),
      }),
    );
  });
});

describe('execute — thresholds', () => {
  it('passes through all provided threshold values', async () => {
    const interaction = makeInteraction({
      sub: 'thresholds',
      integerOptions: {
        timeout_minutes: 30,
        min_account_age_days: 3,
        join_burst_count: 8,
        join_burst_window_seconds: 90,
        captcha_risk_threshold: 60,
        max_captcha_attempts: 5,
        hard_captcha_risk_threshold: 80,
        avatar_reuse_count_threshold: 4,
        avatar_reuse_window_seconds: 400,
        avatar_hamming_threshold: 12,
        username_similarity_count: 4,
        username_similarity_window: 200,
        username_similarity_distance: 3,
        fast_solve_count: 6,
        fast_solve_window_seconds: 240,
        raid_lockdown_join_count: 25,
        raid_lockdown_duration_minutes: 45,
      },
      stringOptions: { captcha_type: 'math' },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      verification_timeout_min: 30,
      min_account_age_days: 3,
      join_burst_count_threshold: 8,
      join_burst_window_seconds: 90,
      captcha_risk_threshold: 60,
      max_captcha_attempts: 5,
      hard_captcha_risk_threshold: 80,
      avatar_reuse_count_threshold: 4,
      avatar_reuse_window_seconds: 400,
      perceptual_avatar_hamming_threshold: 12,
      username_similarity_count_threshold: 4,
      username_similarity_window_seconds: 200,
      username_similarity_distance_threshold: 3,
      fast_solve_count_threshold: 6,
      fast_solve_window_seconds: 240,
      captcha_type: 'math',
      raid_lockdown_join_count_threshold: 25,
      raid_lockdown_duration_minutes: 45,
    });
  });

  it('passes undefined for every omitted threshold option (leave-unchanged contract)', async () => {
    const interaction = makeInteraction({ sub: 'thresholds' });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      verification_timeout_min: undefined,
      min_account_age_days: undefined,
      join_burst_count_threshold: undefined,
      join_burst_window_seconds: undefined,
      captcha_risk_threshold: undefined,
      max_captcha_attempts: undefined,
      hard_captcha_risk_threshold: undefined,
      avatar_reuse_count_threshold: undefined,
      avatar_reuse_window_seconds: undefined,
      perceptual_avatar_hamming_threshold: undefined,
      username_similarity_count_threshold: undefined,
      username_similarity_window_seconds: undefined,
      username_similarity_distance_threshold: undefined,
      fast_solve_count_threshold: undefined,
      fast_solve_window_seconds: undefined,
      captcha_type: undefined,
    });
  });

  it('audit-logs only the fields that were actually changed, not the entire updated config row', async () => {
    const interaction = makeInteraction({
      sub: 'thresholds',
      integerOptions: { timeout_minutes: 30, max_captcha_attempts: 5 },
    });

    await setup.execute(interaction);

    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      thresholds: {
        verification_timeout_min: 30,
        max_captcha_attempts: 5,
      },
    });
  });

  it('translates an explicit 0 for raid_lockdown_join_count into null (the disable sentinel)', async () => {
    const interaction = makeInteraction({
      sub: 'thresholds',
      integerOptions: { raid_lockdown_join_count: 0 },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({ raid_lockdown_join_count_threshold: null }),
    );
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      thresholds: { raid_lockdown_join_count_threshold: null },
    });
  });

  it('leaves raid_lockdown_join_count_threshold unchanged (undefined) when the option is omitted', async () => {
    const interaction = makeInteraction({ sub: 'thresholds' });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({ raid_lockdown_join_count_threshold: undefined }),
    );
  });
});

describe('execute — view', () => {
  it('replies with the current configuration', async () => {
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
    expect(guildConfigMod.getGuildConfig).toHaveBeenCalledTimes(2);
  });

  it("truncates an overlong welcome/honeypot message to Discord's 1024-char embed field limit", async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({
        welcome_message: 'w'.repeat(1500),
        honeypot_bait_message: 'h'.repeat(1500),
      }),
    );
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.find((f) => f.name === 'Welcome message').value).toHaveLength(1024);
    expect(fields.find((f) => f.name === 'Honeypot bait message').value).toHaveLength(1024);
  });

  it('renders configured channels as mentions rather than "Not set"', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({
        verification_channel_id: 'chan-v',
        mod_log_channel_id: 'chan-m',
        honeypot_channel_id: 'chan-h',
      }),
    );
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.find((f) => f.name === 'Verification channel').value).toBe('<#chan-v>');
    expect(fields.find((f) => f.name === 'Mod-log channel').value).toBe('<#chan-m>');
    expect(fields.find((f) => f.name === 'Honeypot channel').value).toBe('<#chan-h>');
  });

  it('warns when the server verification level is low', async () => {
    const interaction = makeInteraction({
      sub: 'view',
      verificationLevel: GuildVerificationLevel.Low,
    });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.some((f) => f.name.includes('Verification Level is low'))).toBe(true);
  });

  it('shows raid lockdown as disabled by default', async () => {
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.find((f) => f.name === 'Raid lockdown').value).toBe('Disabled (unset)');
    expect(fields.some((f) => f.name.includes('Raid lockdown currently active'))).toBe(false);
  });

  it('shows the configured raid lockdown threshold/duration when set', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ raid_lockdown_join_count_threshold: 25, raid_lockdown_duration_minutes: 45 }),
    );
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.find((f) => f.name === 'Raid lockdown').value).toBe(
      '25 joins / burst window, holds 45 min',
    );
  });

  it('warns when a raid lockdown is currently active', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ raid_lockdown_active: 1, raid_lockdown_expires_at: 1_999_999_999_000 }),
    );
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.some((f) => f.name.includes('Raid lockdown currently active'))).toBe(true);
  });

  it('does not warn when the server verification level is not low', async () => {
    const interaction = makeInteraction({
      sub: 'view',
      verificationLevel: GuildVerificationLevel.High,
    });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.some((f) => f.name.includes('Verification Level is low'))).toBe(false);
  });

  it.each(['math', 'random'])(
    'warns when captcha_type is %s (reduced bot-resistance)',
    async (captchaType) => {
      guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ captcha_type: captchaType }));
      const interaction = makeInteraction({ sub: 'view' });

      await setup.execute(interaction);

      const embed = interaction.reply.mock.calls[0][0].embeds[0];
      const fields = embed.data.fields;
      expect(fields.some((f) => f.name.includes('Captcha type reduces bot-resistance'))).toBe(true);
    },
  );

  it('does not warn about captcha type when it is image', async () => {
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.some((f) => f.name.includes('Captcha type reduces bot-resistance'))).toBe(false);
  });
});

describe('execute — review group', () => {
  it('rejects when the member cannot manage the bot', async () => {
    permissions.canManageBot.mockReturnValue(false);
    const interaction = makeInteraction({ subGroup: 'review', sub: 'flagged' });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Manage Server') }),
    );
    expect(pendingVerifications.findFlagged).not.toHaveBeenCalled();
    expect(auditLog.queryAuditLog).not.toHaveBeenCalled();
  });

  it('replies with the flagged-list embed using the default limit', async () => {
    const interaction = makeInteraction({ subGroup: 'review', sub: 'flagged' });

    await setup.execute(interaction);

    expect(pendingVerifications.findFlagged).toHaveBeenCalledWith('guild-1', 20);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [FLAGGED_LIST_EMBED] }),
    );
  });

  it('passes a custom limit through to findFlagged', async () => {
    const interaction = makeInteraction({
      subGroup: 'review',
      sub: 'flagged',
      integerOptions: { limit: 5 },
    });

    await setup.execute(interaction);

    expect(pendingVerifications.findFlagged).toHaveBeenCalledWith('guild-1', 5);
  });

  it('replies with the audit-log embed, passing filters and limit through', async () => {
    const interaction = makeInteraction({
      subGroup: 'review',
      sub: 'log',
      stringOptions: { event_type: 'verified' },
      userOptions: { user: { id: 'user-9' } },
      integerOptions: { limit: 10 },
    });

    await setup.execute(interaction);

    expect(auditLog.queryAuditLog).toHaveBeenCalledWith('guild-1', {
      eventType: 'verified',
      userId: 'user-9',
      limit: 10,
    });
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [AUDIT_LOG_LIST_EMBED] }),
    );
  });

  it('omits eventType/userId and uses the default limit when not provided', async () => {
    const interaction = makeInteraction({ subGroup: 'review', sub: 'log' });

    await setup.execute(interaction);

    expect(auditLog.queryAuditLog).toHaveBeenCalledWith('guild-1', {
      eventType: undefined,
      userId: undefined,
      limit: 20,
    });
  });
});

describe('execute — unrecognized subcommands', () => {
  it('returns without replying for an unrecognized subcommand outside the admins group', async () => {
    const interaction = makeInteraction({ sub: 'not-a-real-subcommand' });

    await expect(setup.execute(interaction)).resolves.toBeUndefined();

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('returns without replying for an unrecognized admins subcommand', async () => {
    const interaction = makeInteraction({ subGroup: 'admins', sub: 'not-a-real-subcommand' });

    await expect(setup.execute(interaction)).resolves.toBeUndefined();

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('returns without replying for an unrecognized review subcommand', async () => {
    const interaction = makeInteraction({ subGroup: 'review', sub: 'not-a-real-subcommand' });

    await expect(setup.execute(interaction)).resolves.toBeUndefined();

    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
