import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let recordJoin;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  ({ recordJoin } = require('../../src/verification/joinBurstTracker.js'));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  teardownTempDb(dbPath);
});

describe('recordJoin', () => {
  it('counts a single join as 1', () => {
    expect(recordJoin('guild-a', 60)).toBe(1);
  });

  it('accumulates joins within the trailing window', () => {
    const guildId = 'guild-b';
    expect(recordJoin(guildId, 60)).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(recordJoin(guildId, 60)).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(recordJoin(guildId, 60)).toBe(3);
  });

  it('drops joins that fall outside the trailing window', () => {
    const guildId = 'guild-c';
    recordJoin(guildId, 30);
    vi.advanceTimersByTime(31_000);
    expect(recordJoin(guildId, 30)).toBe(1);
  });

  it('tracks joins independently per guild', () => {
    recordJoin('guild-d1', 60);
    recordJoin('guild-d1', 60);
    expect(recordJoin('guild-d2', 60)).toBe(1);
    expect(recordJoin('guild-d1', 60)).toBe(3);
  });
});
