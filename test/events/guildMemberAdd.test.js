import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let flow;
let logger;
let guildMemberAdd;

beforeEach(() => {
  bustSrcRequireCache(require);
  flow = injectFakeModule(require, '../../src/verification/flow.js', { handleMemberJoin: vi.fn() });
  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  guildMemberAdd = require('../../src/events/guildMemberAdd.js');
});

function makeMember() {
  return { id: 'user-1', guild: { id: 'guild-1' } };
}

describe('guildMemberAdd.execute', () => {
  it('delegates to handleMemberJoin', async () => {
    flow.handleMemberJoin.mockResolvedValue(undefined);
    const member = makeMember();
    await guildMemberAdd.execute(member);
    expect(flow.handleMemberJoin).toHaveBeenCalledWith(member);
  });

  it('catches and logs a rejection from handleMemberJoin', async () => {
    flow.handleMemberJoin.mockRejectedValue(new Error('boom'));
    const member = makeMember();

    await expect(guildMemberAdd.execute(member)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to handle join for user-1 in guild guild-1:',
      'boom',
    );
  });
});
