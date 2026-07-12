import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let raidSignalEvents;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  raidSignalEvents = require('../../src/database/raidSignalEvents.js');
});

afterEach(() => {
  db.close();
  teardownTempDb(dbPath);
});

describe('insertEvent / countInWindow', () => {
  it('counts events for a guild+kind within the window', () => {
    raidSignalEvents.insertEvent('g1', 'join', null, 1000);
    raidSignalEvents.insertEvent('g1', 'join', null, 2000);
    expect(raidSignalEvents.countInWindow('g1', 'join', 500)).toBe(2);
  });

  it('excludes events at or before the cutoff', () => {
    raidSignalEvents.insertEvent('g1', 'join', null, 1000);
    expect(raidSignalEvents.countInWindow('g1', 'join', 1000)).toBe(0);
    expect(raidSignalEvents.countInWindow('g1', 'join', 999)).toBe(1);
  });

  it('isolates counts by guild and by kind', () => {
    raidSignalEvents.insertEvent('g1', 'join', null, 1000);
    raidSignalEvents.insertEvent('g2', 'join', null, 1000);
    raidSignalEvents.insertEvent('g1', 'fast_solve', null, 1000);
    expect(raidSignalEvents.countInWindow('g1', 'join', 0)).toBe(1);
    expect(raidSignalEvents.countInWindow('g2', 'join', 0)).toBe(1);
    expect(raidSignalEvents.countInWindow('g1', 'fast_solve', 0)).toBe(1);
  });
});

describe('countExactValueInWindow', () => {
  it('only counts matching values within the window', () => {
    raidSignalEvents.insertEvent('g1', 'avatar_exact', 'hash-a', 1000);
    raidSignalEvents.insertEvent('g1', 'avatar_exact', 'hash-a', 2000);
    raidSignalEvents.insertEvent('g1', 'avatar_exact', 'hash-b', 3000);
    expect(raidSignalEvents.countExactValueInWindow('g1', 'avatar_exact', 'hash-a', 0)).toBe(2);
    expect(raidSignalEvents.countExactValueInWindow('g1', 'avatar_exact', 'hash-b', 0)).toBe(1);
  });
});

describe('getValuesInWindow', () => {
  it('returns rows within the window ordered by created_at, excluding outside-window rows', () => {
    raidSignalEvents.insertEvent('g1', 'username', 'raider', 3000);
    raidSignalEvents.insertEvent('g1', 'username', 'raidr', 1000);
    raidSignalEvents.insertEvent('g1', 'username', 'stale', 100);

    const rows = raidSignalEvents.getValuesInWindow('g1', 'username', 500);
    expect(rows.map((r) => r.value)).toEqual(['raidr', 'raider']);
  });
});

describe('pruneExpired', () => {
  it('removes rows older than the retention ceiling and keeps newer ones', () => {
    const now = 2 * 24 * 60 * 60 * 1000; // day 2
    raidSignalEvents.insertEvent('g1', 'join', null, now - 25 * 60 * 60 * 1000); // 25h old
    raidSignalEvents.insertEvent('g1', 'join', null, now - 1 * 60 * 60 * 1000); // 1h old

    raidSignalEvents.pruneExpired(now);

    expect(raidSignalEvents.countInWindow('g1', 'join', 0)).toBe(1);
  });

  it('defaults now to Date.now() when not provided', () => {
    raidSignalEvents.insertEvent('g1', 'join', null, Date.now());
    expect(() => raidSignalEvents.pruneExpired()).not.toThrow();
    expect(raidSignalEvents.countInWindow('g1', 'join', 0)).toBe(1);
  });
});
