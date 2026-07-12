import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let recordFastSolve;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  ({ recordFastSolve } = require('../../src/verification/fastSolveTracker.js'));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  teardownTempDb(dbPath);
});

describe('recordFastSolve', () => {
  it('counts a single fast solve as 1', () => {
    expect(recordFastSolve('guild-a', 300)).toBe(1);
  });

  it('accumulates fast solves within the trailing window', () => {
    const guildId = 'guild-b';
    expect(recordFastSolve(guildId, 300)).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(recordFastSolve(guildId, 300)).toBe(2);
  });

  it('drops fast solves that fall outside the trailing window', () => {
    const guildId = 'guild-c';
    recordFastSolve(guildId, 30);
    vi.advanceTimersByTime(31_000);
    expect(recordFastSolve(guildId, 30)).toBe(1);
  });

  it('tracks fast solves independently per guild', () => {
    recordFastSolve('guild-d1', 300);
    recordFastSolve('guild-d1', 300);
    expect(recordFastSolve('guild-d2', 300)).toBe(1);
    expect(recordFastSolve('guild-d1', 300)).toBe(3);
  });
});
