import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let pendingVerifications;
let auditLog;
let modlog;
let embeds;
let logger;
let raidSignalEvents;
let sweeper;

const AUTO_KICKED_EMBED = { sentinel: 'auto-kicked' };

beforeEach(() => {
  bustSrcRequireCache(require);

  pendingVerifications = injectFakeModule(require, '../../src/database/pendingVerifications.js', {
    findExpired: vi.fn().mockReturnValue([]),
    markKicked: vi.fn(),
  });

  raidSignalEvents = injectFakeModule(require, '../../src/database/raidSignalEvents.js', {
    pruneExpired: vi.fn(),
  });

  injectFakeModule(require, '../../src/database/guildConfig.js', {
    getGuildConfig: vi.fn().mockReturnValue({ mod_log_channel_id: 'chan-1' }),
  });

  auditLog = injectFakeModule(require, '../../src/database/auditLog.js', {
    insertAuditLog: vi.fn(),
  });

  modlog = injectFakeModule(require, '../../src/modlog/modlog.js', {
    send: vi.fn().mockResolvedValue(undefined),
  });

  embeds = injectFakeModule(require, '../../src/modlog/embeds.js', {
    autoKickedEmbed: vi.fn().mockReturnValue(AUTO_KICKED_EMBED),
  });

  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });

  sweeper = require('../../src/scheduler/sweeper.js');

  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeGuild(member) {
  return { members: { fetch: vi.fn().mockResolvedValue(member) } };
}

function makeMember() {
  return { kick: vi.fn().mockResolvedValue(undefined) };
}

function makeClient(guildsFetchImpl) {
  return { guilds: { fetch: vi.fn(guildsFetchImpl) } };
}

describe('sweeper.start', () => {
  it('does nothing when there are no expired records', async () => {
    const client = makeClient();
    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(pendingVerifications.findExpired).toHaveBeenCalledTimes(1);
    expect(pendingVerifications.markKicked).not.toHaveBeenCalled();
  });

  it('prunes expired tracker rows on each sweep', async () => {
    const client = makeClient();
    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(raidSignalEvents.pruneExpired).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(raidSignalEvents.pruneExpired).toHaveBeenCalledTimes(2);
  });

  it('logs and continues when pruning throws', async () => {
    raidSignalEvents.pruneExpired.mockImplementation(() => {
      throw new Error('prune exploded');
    });
    const client = makeClient();

    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith('Tracker prune failed:', 'prune exploded');
  });

  it('kicks the member, marks kicked, audit-logs, and notifies modlog for an expired record', async () => {
    const record = { id: 42, guild_id: 'guild-1', user_id: 'user-1' };
    pendingVerifications.findExpired.mockReturnValue([record]);
    const member = makeMember();
    const client = makeClient(() => Promise.resolve(makeGuild(member)));

    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.guilds.fetch).toHaveBeenCalledWith('guild-1');
    expect(member.kick).toHaveBeenCalledWith('Verification window expired');
    expect(pendingVerifications.markKicked).toHaveBeenCalledWith(42);
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'auto_kicked');
    expect(embeds.autoKickedEmbed).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(modlog.send).toHaveBeenCalledWith(
      client,
      { mod_log_channel_id: 'chan-1' },
      AUTO_KICKED_EMBED,
    );
  });

  it('still marks kicked when the member cannot be resolved', async () => {
    const record = { id: 42, guild_id: 'guild-1', user_id: 'user-1' };
    pendingVerifications.findExpired.mockReturnValue([record]);
    const guild = { members: { fetch: vi.fn().mockRejectedValue(new Error('unknown member')) } };
    const client = makeClient(() => Promise.resolve(guild));

    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(pendingVerifications.markKicked).toHaveBeenCalledWith(42);
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'auto_kicked');
  });

  it('dead-letters a record when the guild is unknown (bot no longer in guild)', async () => {
    const record = { id: 42, guild_id: 'guild-gone', user_id: 'user-1' };
    pendingVerifications.findExpired.mockReturnValue([record]);
    const unknownGuildError = Object.assign(new Error('Unknown Guild'), { code: 10004 });
    const client = makeClient(() => Promise.reject(unknownGuildError));

    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(pendingVerifications.markKicked).toHaveBeenCalledWith(42);
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-gone', 'user-1', 'auto_kicked');
    expect(modlog.send).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not stop the sweep when one record throws — a later record still completes', async () => {
    const badRecord = { id: 1, guild_id: 'guild-bad', user_id: 'user-bad' };
    const goodRecord = { id: 2, guild_id: 'guild-good', user_id: 'user-good' };
    pendingVerifications.findExpired.mockReturnValue([badRecord, goodRecord]);
    const goodMember = makeMember();
    const client = makeClient((guildId) => {
      if (guildId === 'guild-bad') return Promise.reject(new Error('guild gone'));
      return Promise.resolve(makeGuild(goodMember));
    });

    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith(
      'Sweeper failed to process guild-bad/user-bad:',
      'guild gone',
    );
    expect(pendingVerifications.markKicked).toHaveBeenCalledWith(2);
    expect(pendingVerifications.markKicked).not.toHaveBeenCalledWith(1);
  });

  it('sweeps immediately, then again every 60 seconds', async () => {
    const client = makeClient();
    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingVerifications.findExpired).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(pendingVerifications.findExpired).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(pendingVerifications.findExpired).toHaveBeenCalledTimes(3);
  });

  it('logs an error when the initial sweep rejects', async () => {
    pendingVerifications.findExpired.mockImplementation(() => {
      throw new Error('db exploded');
    });
    const client = makeClient();

    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith('Initial sweep failed:', 'db exploded');
  });

  it('logs an error when a later interval sweep rejects', async () => {
    let callCount = 0;
    pendingVerifications.findExpired.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return [];
      throw new Error('db exploded again');
    });
    const client = makeClient();

    sweeper.start(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(logger.error).toHaveBeenCalledWith('Sweep failed:', 'db exploded again');
  });
});
