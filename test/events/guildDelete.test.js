import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let db;
let guildConfig;
let pendingVerifications;
let auditLog;
let raidSignalEvents;
let logger;
let guildDelete;

beforeEach(() => {
  bustSrcRequireCache(require);

  db = injectFakeModule(require, '../../src/database/db.js', {
    exec: vi.fn(),
  });

  guildConfig = injectFakeModule(require, '../../src/database/guildConfig.js', {
    deleteGuildConfig: vi.fn(),
  });

  pendingVerifications = injectFakeModule(require, '../../src/database/pendingVerifications.js', {
    deleteAllForGuild: vi.fn(),
  });

  auditLog = injectFakeModule(require, '../../src/database/auditLog.js', {
    deleteAllForGuild: vi.fn(),
  });

  raidSignalEvents = injectFakeModule(require, '../../src/database/raidSignalEvents.js', {
    deleteAllForGuild: vi.fn(),
  });

  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });

  guildDelete = require('../../src/events/guildDelete.js');
});

function makeGuild(available = true) {
  return { id: 'guild-1', available };
}

describe('guildDelete.execute', () => {
  it('purges data for every table, wrapped in a transaction, when the bot is removed', async () => {
    const guild = makeGuild(true);
    await guildDelete.execute(guild);

    expect(db.exec).toHaveBeenCalledWith('BEGIN');
    expect(pendingVerifications.deleteAllForGuild).toHaveBeenCalledWith('guild-1');
    expect(auditLog.deleteAllForGuild).toHaveBeenCalledWith('guild-1');
    expect(raidSignalEvents.deleteAllForGuild).toHaveBeenCalledWith('guild-1');
    expect(guildConfig.deleteGuildConfig).toHaveBeenCalledWith('guild-1');
    expect(db.exec).toHaveBeenCalledWith('COMMIT');
    expect(logger.info).toHaveBeenCalledWith(
      'Purged stored data for guild guild-1 (bot removed from guild).',
    );
  });

  it('does nothing when the guild is merely unavailable (outage), not actually removed', async () => {
    const guild = makeGuild(false);
    await guildDelete.execute(guild);

    expect(db.exec).not.toHaveBeenCalled();
    expect(pendingVerifications.deleteAllForGuild).not.toHaveBeenCalled();
    expect(auditLog.deleteAllForGuild).not.toHaveBeenCalled();
    expect(raidSignalEvents.deleteAllForGuild).not.toHaveBeenCalled();
    expect(guildConfig.deleteGuildConfig).not.toHaveBeenCalled();
  });

  it('rolls back and logs when a delete throws', async () => {
    const guild = makeGuild(true);
    auditLog.deleteAllForGuild.mockImplementation(() => {
      throw new Error('disk full');
    });

    await expect(guildDelete.execute(guild)).resolves.toBeUndefined();

    expect(db.exec).toHaveBeenCalledWith('ROLLBACK');
    expect(guildConfig.deleteGuildConfig).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to purge data for guild guild-1:',
      'disk full',
    );
  });
});
