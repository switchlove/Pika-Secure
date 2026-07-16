import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let guildConfig;
let honeypot;
let messageCreate;

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
  messageCreate = require('../../src/events/messageCreate.js');
});

function makeMessage(overrides = {}) {
  return {
    author: { bot: false },
    guildId: 'guild-1',
    channelId: 'chan-1',
    client: {},
    member: { permissions: { has: vi.fn().mockReturnValue(false) } },
    ...overrides,
  };
}

describe('messageCreate.execute', () => {
  it('ignores messages from bots', async () => {
    const message = makeMessage({ author: { bot: true } });
    await messageCreate.execute(message);
    expect(guildConfig.getGuildConfig).not.toHaveBeenCalled();
  });

  it('ignores DMs (no guildId)', async () => {
    const message = makeMessage({ guildId: null });
    await messageCreate.execute(message);
    expect(guildConfig.getGuildConfig).not.toHaveBeenCalled();
  });

  it('ignores messages with no resolvable member', async () => {
    const message = makeMessage({ member: null });
    await messageCreate.execute(message);
    expect(guildConfig.getGuildConfig).not.toHaveBeenCalled();
  });

  it('does nothing when no honeypot channel is configured', async () => {
    guildConfig.getGuildConfig.mockReturnValue({});
    await messageCreate.execute(makeMessage());
    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('does nothing when the message is not in the honeypot channel', async () => {
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'other-chan' });
    await messageCreate.execute(makeMessage({ channelId: 'chan-1' }));
    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('exempts staff-permission members', async () => {
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });
    const message = makeMessage();
    message.member.permissions.has.mockReturnValue(true);

    await messageCreate.execute(message);

    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('exempts a member who has only one of the exempt permissions', async () => {
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });
    const message = makeMessage();
    message.member.permissions.has.mockImplementation((flag) => flag === 'flag-b');

    await messageCreate.execute(message);

    expect(honeypot.triggerHoneypot).not.toHaveBeenCalled();
  });

  it('does not exempt a member who has none of the exempt permissions', async () => {
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });
    const message = makeMessage();
    message.member.permissions.has.mockReturnValue(false);

    await messageCreate.execute(message);

    expect(honeypot.triggerHoneypot).toHaveBeenCalled();
  });

  it('triggers the honeypot for a non-exempt member posting in the honeypot channel', async () => {
    guildConfig.getGuildConfig.mockReturnValue({ honeypot_channel_id: 'chan-1' });
    const message = makeMessage();

    await messageCreate.execute(message);

    expect(honeypot.triggerHoneypot).toHaveBeenCalledWith(
      message.member,
      { honeypot_channel_id: 'chan-1' },
      message.client,
      { channelId: 'chan-1', trigger: 'message' },
    );
  });
});
