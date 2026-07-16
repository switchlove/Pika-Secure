import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let guildConfig;
let honeypot;
let logger;
let messageReactionAdd;

beforeEach(() => {
  bustSrcRequireCache(require);
  guildConfig = injectFakeModule(require, '../../src/database/guildConfig.js', {
    getGuildConfig: vi.fn(),
  });
  honeypot = injectFakeModule(require, '../../src/verification/honeypot.js', {
    STAFF_EXEMPT_PERMISSIONS: ['flag-a', 'flag-b'],
    triggerHoneypot: vi.fn(),
    isHoneypotChannel: (guildConfig, channelId) =>
      Boolean(guildConfig.honeypot_channel_id) && channelId === guildConfig.honeypot_channel_id,
    isStaffExempt: (member) => ['flag-a', 'flag-b'].some((flag) => member.permissions.has(flag)),
  });
  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  messageReactionAdd = require('../../src/events/messageReactionAdd.js');
});

function makeMessage(overrides = {}) {
  return {
    partial: false,
    guildId: 'guild-1',
    channelId: 'chan-1',
    client: {},
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({ permissions: { has: vi.fn().mockReturnValue(false) } }),
      },
    },
    ...overrides,
  };
}

function makeReaction(message, overrides = {}) {
  return {
    partial: false,
    fetch: vi.fn().mockResolvedValue(undefined),
    message,
    ...overrides,
  };
}

function makeUser({ bot = false, id = 'user-1' } = {}) {
  return { bot, id };
}

describe('messageReactionAdd.execute', () => {
  it('ignores reactions from bots', async () => {
    const message = makeMessage();
    const reaction = makeReaction(message);
    await messageReactionAdd.execute(reaction, makeUser({ bot: true }));
    expect(guildConfig.getGuildConfig).not.toHaveBeenCalled();
  });

  it('fetches a partial reaction before proceeding', async () => {
    const message = makeMessage();
    const reaction = makeReaction(message, { partial: true });
    guildConfig.getGuildConfig.mockReturnValue({});
    await messageReactionAdd.execute(reaction, makeUser());
    expect(reaction.fetch).toHaveBeenCalled();
  });

  it('fetches a partial message before proceeding', async () => {
    const message = makeMessage({ partial: true, fetch: vi.fn().mockResolvedValue(undefined) });
    const reaction = makeReaction(message);
    guildConfig.getGuildConfig.mockReturnValue({});
    await messageReactionAdd.execute(reaction, makeUser());
    expect(message.fetch).toHaveBeenCalled();
  });

  it('aborts and logs a warning when the partial reaction fetch fails', async () => {
    const message = makeMessage();
    const reaction = makeReaction(message, {
      partial: true,
      fetch: vi.fn().mockRejectedValue(new Error('gone')),
    });

    await expect(messageReactionAdd.execute(reaction, makeUser())).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith('Failed to fetch partial honeypot reaction:', 'gone');
    expect(guildConfig.getGuildConfig).not.toHaveBeenCalled();
  });

  it('aborts and logs a warning when the partial message fetch fails', async () => {
    const message = makeMessage({
      partial: true,
      fetch: vi.fn().mockRejectedValue(new Error('gone')),
    });
    const reaction = makeReaction(message);

    await expect(messageReactionAdd.execute(reaction, makeUser())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Failed to fetch partial honeypot reaction:', 'gone');
  });

  it('does nothing when the message has no guildId', async () => {
    const message = makeMessage({ guildId: null });
    const reaction = makeReaction(message);
    await messageReactionAdd.execute(reaction, makeUser());
    expect(guildConfig.getGuildConfig).not.toHaveBeenCalled();
  });

  it('does nothing when no honeypot channel is configured', async () => {
    const message = makeMessage();
    const reaction = makeReaction(message);
    guildConfig.getGuildConfig.mockReturnValue({});
    await messageReactionAdd.execute(reaction, makeUser());
    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('does nothing when the reaction is not on the honeypot message', async () => {
    const message = makeMessage({ channelId: 'other-chan' });
    const reaction = makeReaction(message);
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });
    await messageReactionAdd.execute(reaction, makeUser());
    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('aborts when the reacting member cannot be resolved', async () => {
    const message = makeMessage();
    message.guild.members.fetch = vi.fn().mockRejectedValue(new Error('unknown member'));
    const reaction = makeReaction(message);
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });

    await messageReactionAdd.execute(reaction, makeUser());

    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('exempts staff-permission members', async () => {
    const message = makeMessage();
    message.guild.members.fetch = vi
      .fn()
      .mockResolvedValue({ permissions: { has: vi.fn().mockReturnValue(true) } });
    const reaction = makeReaction(message);
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });

    await messageReactionAdd.execute(reaction, makeUser());

    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('exempts a member who has only one of the exempt permissions', async () => {
    const message = makeMessage();
    message.guild.members.fetch = vi.fn().mockResolvedValue({
      permissions: { has: vi.fn().mockImplementation((flag) => flag === 'flag-b') },
    });
    const reaction = makeReaction(message);
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });

    await messageReactionAdd.execute(reaction, makeUser());

    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('triggers the honeypot for a non-exempt member reacting on the bait message', async () => {
    const member = { permissions: { has: vi.fn().mockReturnValue(false) } };
    const message = makeMessage();
    message.guild.members.fetch = vi.fn().mockResolvedValue(member);
    const reaction = makeReaction(message);
    const guildConfigValue = { honeypot_channel_id: 'chan-1' };
    guildConfig.getGuildConfig.mockReturnValue(guildConfigValue);
    const user = makeUser();

    await messageReactionAdd.execute(reaction, user);

    expect(message.guild.members.fetch).toHaveBeenCalledWith(user.id);
    expect(honeypot.triggerHoneypot).toHaveBeenCalledWith(
      member,
      guildConfigValue,
      message.client,
      {
        channelId: 'chan-1',
        trigger: 'reaction',
      },
    );
  });
});
