import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let logger;
let guildCreate;

beforeEach(() => {
  bustSrcRequireCache(require);
  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  guildCreate = require('../../src/events/guildCreate.js');
});

function makeGuild({ me, fetchMeResolves = me } = {}) {
  return {
    id: 'guild-1',
    members: {
      me,
      fetchMe: vi.fn().mockResolvedValue(fetchMeResolves),
    },
  };
}

describe('guildCreate.execute', () => {
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
});
