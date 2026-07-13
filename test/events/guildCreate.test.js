import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let logger;
let guildConfigMod;
let guildCreate;

const CONFIGURED = { unverified_role_id: 'role-1', verification_channel_id: 'chan-1' };
const UNCONFIGURED = { unverified_role_id: null, verification_channel_id: null };

beforeEach(() => {
  bustSrcRequireCache(require);
  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  guildConfigMod = injectFakeModule(require, '../../src/database/guildConfig.js', {
    getGuildConfig: vi.fn().mockReturnValue(CONFIGURED),
  });
  guildCreate = require('../../src/events/guildCreate.js');
});

function makeGuild({ me, fetchMeResolves = me, systemChannel = null, canSend = true } = {}) {
  return {
    id: 'guild-1',
    members: {
      me,
      fetchMe: vi.fn().mockResolvedValue(fetchMeResolves),
    },
    systemChannel: systemChannel && {
      send: vi.fn().mockResolvedValue(undefined),
      permissionsFor: vi.fn().mockReturnValue({ has: vi.fn().mockReturnValue(canSend) }),
      ...systemChannel,
    },
  };
}

describe('guildCreate.execute — bot role color', () => {
  it('does nothing when the bot has no role in the guild', async () => {
    const me = { roles: { botRole: null } };
    const guild = makeGuild({ me });
    await guildCreate.execute(guild);
    expect(guild.members.fetchMe).not.toHaveBeenCalled();
  });

  it('sets the bot role color when a bot role exists', async () => {
    const setColor = vi.fn().mockResolvedValue(undefined);
    const me = { roles: { botRole: { setColor } } };
    const guild = makeGuild({ me });
    await guildCreate.execute(guild);
    expect(setColor).toHaveBeenCalledWith(0xf6cf57);
  });

  it('falls back to fetchMe() when members.me is not cached', async () => {
    const setColor = vi.fn().mockResolvedValue(undefined);
    const fetched = { roles: { botRole: { setColor } } };
    const guild = makeGuild({ me: undefined, fetchMeResolves: fetched });
    await guildCreate.execute(guild);
    expect(guild.members.fetchMe).toHaveBeenCalled();
    expect(setColor).toHaveBeenCalledWith(0xf6cf57);
  });

  it('catches and logs a rejection instead of throwing', async () => {
    const setColor = vi.fn().mockRejectedValue(new Error('missing perms'));
    const me = { roles: { botRole: { setColor } } };
    const guild = makeGuild({ me });

    await expect(guildCreate.execute(guild)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to set bot role color in guild guild-1:',
      'missing perms',
    );
  });

  it('logs and returns early when the bot member itself cannot be resolved', async () => {
    const guild = makeGuild({
      me: undefined,
      fetchMeResolves: undefined,
    });
    guild.members.fetchMe.mockRejectedValue(new Error('gateway timeout'));

    await expect(guildCreate.execute(guild)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to resolve bot member in guild guild-1:',
      'gateway timeout',
    );
  });
});

describe('guildCreate.execute — setup reminder', () => {
  const me = { roles: { botRole: null } };

  it('does nothing when the guild is already configured', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(CONFIGURED);
    const guild = makeGuild({ me, systemChannel: {} });

    await guildCreate.execute(guild);

    expect(guild.systemChannel.send).not.toHaveBeenCalled();
  });

  it('does nothing when there is no system channel', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(UNCONFIGURED);
    const guild = makeGuild({ me, systemChannel: null });

    await expect(guildCreate.execute(guild)).resolves.toBeUndefined();
  });

  it('does nothing when the bot lacks Send Messages in the system channel', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(UNCONFIGURED);
    const guild = makeGuild({ me, systemChannel: {}, canSend: false });

    await guildCreate.execute(guild);

    expect(guild.systemChannel.send).not.toHaveBeenCalled();
  });

  it('posts a reminder to the system channel when unconfigured', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(UNCONFIGURED);
    const guild = makeGuild({ me, systemChannel: {} });

    await guildCreate.execute(guild);

    expect(guild.systemChannel.send).toHaveBeenCalledWith(expect.stringContaining('/setup'));
  });

  it('catches and logs a rejection instead of throwing', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(UNCONFIGURED);
    const guild = makeGuild({ me, systemChannel: {} });
    guild.systemChannel.send.mockRejectedValue(new Error('missing access'));

    await expect(guildCreate.execute(guild)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to post setup reminder in guild guild-1:',
      'missing access',
    );
  });
});
