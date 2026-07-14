import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { GuildVerificationLevel, RESTJSONErrorCodes } from 'discord.js';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let guildConfigMod;
let auditLog;
let modlog;
let embeds;
let logger;
let raidLockdown;

const ENGAGED_EMBED = { sentinel: 'engaged' };
const LIFTED_EMBED = { sentinel: 'lifted' };

beforeEach(() => {
  bustSrcRequireCache(require);

  guildConfigMod = injectFakeModule(require, '../../src/database/guildConfig.js', {
    updateGuildConfig: vi.fn((guildId, fields) => ({ guild_id: guildId, ...fields })),
  });

  auditLog = injectFakeModule(require, '../../src/database/auditLog.js', {
    insertAuditLog: vi.fn(),
  });

  modlog = injectFakeModule(require, '../../src/modlog/modlog.js', {
    send: vi.fn().mockResolvedValue(undefined),
  });

  embeds = injectFakeModule(require, '../../src/modlog/embeds.js', {
    raidLockdownEngagedEmbed: vi.fn().mockReturnValue(ENGAGED_EMBED),
    raidLockdownLiftedEmbed: vi.fn().mockReturnValue(LIFTED_EMBED),
  });

  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });

  raidLockdown = require('../../src/verification/raidLockdown.js');
});

function makeGuild(overrides = {}) {
  return {
    id: 'guild-1',
    client: { sentinel: 'client' },
    verificationLevel: GuildVerificationLevel.Medium,
    setVerificationLevel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseGuildConfig(overrides = {}) {
  return {
    guild_id: 'guild-1',
    raid_lockdown_join_count_threshold: 15,
    raid_lockdown_duration_minutes: 30,
    raid_lockdown_active: 0,
    raid_lockdown_expires_at: null,
    raid_lockdown_previous_verification_level: null,
    ...overrides,
  };
}

describe('maybeEngage', () => {
  it('does nothing when the threshold is unset (feature disabled)', async () => {
    const guild = makeGuild();
    await raidLockdown.maybeEngage(
      guild,
      baseGuildConfig({ raid_lockdown_join_count_threshold: null }),
      999,
    );

    expect(guild.setVerificationLevel).not.toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('does nothing when a lockdown is already active', async () => {
    const guild = makeGuild();
    await raidLockdown.maybeEngage(guild, baseGuildConfig({ raid_lockdown_active: 1 }), 999);

    expect(guild.setVerificationLevel).not.toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('does nothing when burst count is below the threshold', async () => {
    const guild = makeGuild();
    await raidLockdown.maybeEngage(guild, baseGuildConfig(), 10);

    expect(guild.setVerificationLevel).not.toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('raises verification level, persists state, and alerts when the threshold is crossed', async () => {
    const guild = makeGuild({ verificationLevel: GuildVerificationLevel.Low });
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    await raidLockdown.maybeEngage(guild, baseGuildConfig(), 20);

    expect(guild.setVerificationLevel).toHaveBeenCalledWith(
      GuildVerificationLevel.VeryHigh,
      expect.stringContaining('20 joins'),
    );
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      raid_lockdown_active: 1,
      raid_lockdown_expires_at: 1_000_000 + 30 * 60_000,
      raid_lockdown_previous_verification_level: GuildVerificationLevel.Low,
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', null, 'raid_lockdown_engaged', {
      burstCount: 20,
      previousLevel: GuildVerificationLevel.Low,
      levelRaised: true,
    });
    expect(embeds.raidLockdownEngagedEmbed).toHaveBeenCalledWith(20, true);
    expect(modlog.send).toHaveBeenCalledWith(
      guild.client,
      expect.objectContaining({ guild_id: 'guild-1' }),
      ENGAGED_EMBED,
    );

    vi.useRealTimers();
  });

  it('does not call setVerificationLevel when already at the lockdown level, but still alerts', async () => {
    const guild = makeGuild({ verificationLevel: GuildVerificationLevel.VeryHigh });

    await raidLockdown.maybeEngage(guild, baseGuildConfig(), 20);

    expect(guild.setVerificationLevel).not.toHaveBeenCalled();
    expect(embeds.raidLockdownEngagedEmbed).toHaveBeenCalledWith(20, false);
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith(
      'guild-1',
      null,
      'raid_lockdown_engaged',
      expect.objectContaining({ levelRaised: false }),
    );
  });

  it('still alerts and persists state even when raising the verification level fails', async () => {
    const guild = makeGuild({
      verificationLevel: GuildVerificationLevel.Low,
      setVerificationLevel: vi.fn().mockRejectedValue(new Error('missing Manage Server')),
    });

    await raidLockdown.maybeEngage(guild, baseGuildConfig(), 20);

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to raise verification level in guild guild-1:',
      'missing Manage Server',
    );
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({ raid_lockdown_active: 1 }),
    );
    expect(embeds.raidLockdownEngagedEmbed).toHaveBeenCalledWith(20, false);
  });

  it('ignores a second overlapping call for the same guild while the first is still engaging', async () => {
    const guild = makeGuild({ verificationLevel: GuildVerificationLevel.Low });
    let resolveSetLevel;
    guild.setVerificationLevel = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSetLevel = resolve;
        }),
    );

    const firstCall = raidLockdown.maybeEngage(guild, baseGuildConfig(), 20);
    await raidLockdown.maybeEngage(guild, baseGuildConfig(), 20);

    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();

    resolveSetLevel();
    await firstCall;

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledTimes(1);
  });
});

describe('liftIfExpired', () => {
  function makeClient(guildsFetchImpl) {
    return { guilds: { fetch: vi.fn(guildsFetchImpl) } };
  }

  it('does nothing when no lockdown is active', async () => {
    const client = makeClient();
    await raidLockdown.liftIfExpired(client, baseGuildConfig({ raid_lockdown_active: 0 }));

    expect(client.guilds.fetch).not.toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).not.toHaveBeenCalled();
  });

  it('does nothing when the lockdown has not yet expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const client = makeClient();
    await raidLockdown.liftIfExpired(
      client,
      baseGuildConfig({ raid_lockdown_active: 1, raid_lockdown_expires_at: 2_000_000 }),
    );

    expect(client.guilds.fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('reverts the verification level and clears state when expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const guild = makeGuild();
    const client = makeClient(() => Promise.resolve(guild));

    await raidLockdown.liftIfExpired(
      client,
      baseGuildConfig({
        raid_lockdown_active: 1,
        raid_lockdown_expires_at: 1_000_000,
        raid_lockdown_previous_verification_level: GuildVerificationLevel.Low,
      }),
    );

    expect(guild.setVerificationLevel).toHaveBeenCalledWith(
      GuildVerificationLevel.Low,
      expect.stringContaining('reverting'),
    );
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      raid_lockdown_active: 0,
      raid_lockdown_expires_at: null,
      raid_lockdown_previous_verification_level: null,
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', null, 'raid_lockdown_lifted', {
      reverted: true,
    });
    expect(embeds.raidLockdownLiftedEmbed).toHaveBeenCalledWith(true);
    expect(modlog.send).toHaveBeenCalledWith(client, expect.any(Object), LIFTED_EMBED);

    vi.useRealTimers();
  });

  it('clears state and does not log an error when the guild is unknown (bot removed)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const unknownGuildError = Object.assign(new Error('Unknown Guild'), {
      code: RESTJSONErrorCodes.UnknownGuild,
    });
    const client = makeClient(() => Promise.reject(unknownGuildError));

    await raidLockdown.liftIfExpired(
      client,
      baseGuildConfig({ raid_lockdown_active: 1, raid_lockdown_expires_at: 1_000_000 }),
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      raid_lockdown_active: 0,
      raid_lockdown_expires_at: null,
      raid_lockdown_previous_verification_level: null,
    });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', null, 'raid_lockdown_lifted', {
      reverted: false,
    });

    vi.useRealTimers();
  });

  it('logs an error, but still clears state, when reverting fails for another reason', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const guild = makeGuild({
      setVerificationLevel: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const client = makeClient(() => Promise.resolve(guild));

    await raidLockdown.liftIfExpired(
      client,
      baseGuildConfig({ raid_lockdown_active: 1, raid_lockdown_expires_at: 1_000_000 }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to revert verification level in guild guild-1:',
      'rate limited',
    );
    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledWith('guild-1', {
      raid_lockdown_active: 0,
      raid_lockdown_expires_at: null,
      raid_lockdown_previous_verification_level: null,
    });
    expect(embeds.raidLockdownLiftedEmbed).toHaveBeenCalledWith(false);

    vi.useRealTimers();
  });

  it('ignores a second overlapping call for the same guild while the first is still lifting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    let resolveFetch;
    const client = makeClient(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const guildConfig = baseGuildConfig({
      raid_lockdown_active: 1,
      raid_lockdown_expires_at: 1_000_000,
    });

    const firstCall = raidLockdown.liftIfExpired(client, guildConfig);
    await raidLockdown.liftIfExpired(client, guildConfig);

    expect(client.guilds.fetch).toHaveBeenCalledTimes(1);

    resolveFetch(makeGuild());
    await firstCall;

    expect(guildConfigMod.updateGuildConfig).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
