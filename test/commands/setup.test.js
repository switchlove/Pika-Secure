import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let guildConfigMod;
let auditLog;
let permissions;
let quarantine;
let logger;
let setup;

const GATE_PAYLOAD = { sentinel: 'gate-payload' };
const BAIT_PAYLOAD = { sentinel: 'bait-payload' };

function baseConfig(overrides = {}) {
  return {
    guild_id: 'guild-1',
    unverified_role_id: null,
    verified_role_id: null,
    verification_channel_id: null,
    mod_log_channel_id: null,
    honeypot_channel_id: null,
    honeypot_message_id: null,
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
    admin_role_ids: [],
    ...overrides,
  };
}

beforeEach(() => {
  bustSrcRequireCache(require);

  guildConfigMod = injectFakeModule(require, '../../src/database/guildConfig.js', {
    getGuildConfig: vi.fn().mockReturnValue(baseConfig()),
    updateGuildConfig: vi.fn().mockReturnValue(baseConfig()),
  });

  auditLog = injectFakeModule(require, '../../src/database/auditLog.js', { insertAuditLog: vi.fn() });

  permissions = injectFakeModule(require, '../../src/utils/permissions.js', {
    canManageBot: vi.fn().mockReturnValue(true),
    isTrueAdmin: vi.fn().mockReturnValue(true),
  });

  quarantine = injectFakeModule(require, '../../src/verification/quarantine.js', {
    buildGateMessagePayload: vi.fn().mockReturnValue(GATE_PAYLOAD),
    buildHoneypotBaitPayload: vi.fn().mockReturnValue(BAIT_PAYLOAD),
    syncChannelPermissions: vi.fn().mockResolvedValue([]),
    syncHoneypotPermissions: vi.fn().mockResolvedValue([]),
    HONEYPOT_BAIT_EMOJI: '🎉',
  });

  logger = injectFakeModule(require, '../../src/utils/logger.js', { warn: vi.fn(), error: vi.fn(), info: vi.fn() });

  setup = require('../../src/commands/setup.js');
});

function makeInteraction({ subGroup = null, sub, roleOptions = {}, channelOptions = {}, integerOptions = {} } = {}) {
  return {
    guild: { id: 'guild-1', channels: { fetch: vi.fn() } },
    member: { id: 'admin-member' },
    user: { id: 'admin-user' },
    options: {
      getSubcommandGroup: vi.fn(() => subGroup),
      getSubcommand: vi.fn(() => sub),
      getRole: vi.fn((name) => roleOptions[name]),
      getChannel: vi.fn((name) => channelOptions[name]),
      getInteger: vi.fn((name) => (name in integerOptions ? integerOptions[name] : null)),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('data', () => {
  it('is named "setup"', () => {
    expect(setup.data.name).toBe('setup');
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

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
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
    guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ admin_role_ids: ['role-existing'] }));
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
    guildConfigMod.getGuildConfig.mockReturnValue(baseConfig({ admin_role_ids: ['role-a', 'role-b'] }));
    const interaction = makeInteraction({
      subGroup: 'admins',
      sub: 'remove',
      roleOptions: { role: { id: 'role-a' } },
    });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', { admin_role_ids: ['role-b'] });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'admin-user', 'setup_changed', {
      admin_roles_removed: 'role-a',
    });
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
    expect(quarantine.syncChannelPermissions).toHaveBeenCalledWith(interaction.guild, expect.any(Object));
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: undefined, embeds: expect.any(Array) }),
    );
  });

  it('passes verified_role_id as undefined when the optional role is omitted', async () => {
    const interaction = makeInteraction({ sub: 'roles', roleOptions: { unverified: { id: 'role-u' } } });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      unverified_role_id: 'role-u',
      verified_role_id: undefined,
    });
  });

  it('surfaces a permission warning when syncChannelPermissions reports failures', async () => {
    quarantine.syncChannelPermissions.mockResolvedValue(['verification channel (<#x>): no access']);
    const interaction = makeInteraction({ sub: 'roles', roleOptions: { unverified: { id: 'role-u' } } });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Couldn't update permissions") }),
    );
  });
});

describe('execute — channels', () => {
  it('sets channels, syncs permissions, and posts the gate message', async () => {
    const updatedConfig = baseConfig({ verification_channel_id: 'chan-v', mod_log_channel_id: 'chan-m' });
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
    expect(verificationChannel.send).toHaveBeenCalledWith(GATE_PAYLOAD);
    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(2, 'guild-1', { gate_message_id: 'gate-msg-1' });
    expect(guildConfigMod.getGuildConfig).toHaveBeenCalledTimes(2);
  });

  it('still replies successfully when posting the gate message fails', async () => {
    const verificationChannel = { id: 'chan-v', send: vi.fn().mockRejectedValue(new Error('no perms')) };
    const interaction = makeInteraction({
      sub: 'channels',
      channelOptions: { verification: verificationChannel, modlog: { id: 'chan-m' } },
    });

    await setup.execute(interaction);

    expect(logger.error).toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });
});

describe('execute — honeypot', () => {
  it('sets the honeypot channel, syncs permissions, and posts/reacts to the bait message', async () => {
    const baitMessage = { id: 'bait-msg-1', react: vi.fn().mockResolvedValue(undefined) };
    const honeypotChannel = { id: 'chan-h', send: vi.fn().mockResolvedValue(baitMessage) };
    guildConfigMod.updateGuildConfig.mockReturnValue(baseConfig({ honeypot_channel_id: 'chan-h' }));
    const interaction = makeInteraction({ sub: 'honeypot', channelOptions: { channel: honeypotChannel } });

    await setup.execute(interaction);

    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(1, 'guild-1', {
      honeypot_channel_id: 'chan-h',
    });
    expect(quarantine.syncHoneypotPermissions).toHaveBeenCalledWith(interaction.guild, expect.any(Object));
    expect(honeypotChannel.send).toHaveBeenCalledWith(BAIT_PAYLOAD);
    expect(baitMessage.react).toHaveBeenCalledWith('🎉');
    expect(guildConfigMod.updateGuildConfig).toHaveBeenNthCalledWith(2, 'guild-1', {
      honeypot_message_id: 'bait-msg-1',
    });
  });

  it('still replies successfully when posting the bait message fails', async () => {
    const honeypotChannel = { id: 'chan-h', send: vi.fn().mockRejectedValue(new Error('no perms')) };
    const interaction = makeInteraction({ sub: 'honeypot', channelOptions: { channel: honeypotChannel } });

    await setup.execute(interaction);

    expect(logger.error).toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('skips refreshing the gate message when no gate message exists yet', async () => {
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ honeypot_channel_id: 'chan-h', verification_channel_id: null, gate_message_id: null }),
    );
    const honeypotChannel = { id: 'chan-h', send: vi.fn().mockResolvedValue({ id: 'm', react: vi.fn().mockResolvedValue() }) };
    const interaction = makeInteraction({ sub: 'honeypot', channelOptions: { channel: honeypotChannel } });

    await setup.execute(interaction);

    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('refreshes an existing gate message when both channel and message id are set', async () => {
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ honeypot_channel_id: 'chan-h', verification_channel_id: 'chan-v', gate_message_id: 'gate-1' }),
    );
    const honeypotChannel = { id: 'chan-h', send: vi.fn().mockResolvedValue({ id: 'm', react: vi.fn().mockResolvedValue() }) };
    const gateMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const verificationChannel = { messages: { fetch: vi.fn().mockResolvedValue(gateMessage) } };
    const interaction = makeInteraction({ sub: 'honeypot', channelOptions: { channel: honeypotChannel } });
    interaction.guild.channels.fetch.mockResolvedValue(verificationChannel);

    await setup.execute(interaction);

    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('chan-v');
    expect(verificationChannel.messages.fetch).toHaveBeenCalledWith('gate-1');
    expect(gateMessage.edit).toHaveBeenCalledWith(GATE_PAYLOAD);
  });

  it('logs and continues when refreshing the gate message fails', async () => {
    guildConfigMod.updateGuildConfig.mockReturnValue(
      baseConfig({ honeypot_channel_id: 'chan-h', verification_channel_id: 'chan-v', gate_message_id: 'gate-1' }),
    );
    const honeypotChannel = { id: 'chan-h', send: vi.fn().mockResolvedValue({ id: 'm', react: vi.fn().mockResolvedValue() }) };
    const interaction = makeInteraction({ sub: 'honeypot', channelOptions: { channel: honeypotChannel } });
    interaction.guild.channels.fetch.mockRejectedValue(new Error('channel gone'));

    await expect(setup.execute(interaction)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
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
      },
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
    });
  });
});

describe('execute — view', () => {
  it('replies with the current configuration', async () => {
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    expect(guildConfigMod.getGuildConfig).toHaveBeenCalledTimes(2);
  });

  it('renders configured channels as mentions rather than "Not set"', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(
      baseConfig({ verification_channel_id: 'chan-v', mod_log_channel_id: 'chan-m', honeypot_channel_id: 'chan-h' }),
    );
    const interaction = makeInteraction({ sub: 'view' });

    await setup.execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fields = embed.data.fields;
    expect(fields.find((f) => f.name === 'Verification channel').value).toBe('<#chan-v>');
    expect(fields.find((f) => f.name === 'Mod-log channel').value).toBe('<#chan-m>');
    expect(fields.find((f) => f.name === 'Honeypot channel').value).toBe('<#chan-h>');
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
});
