import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let normalizeUsername;
let levenshteinDistance;
let recordUsername;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  ({ normalizeUsername, levenshteinDistance, recordUsername } = require(
    '../../src/verification/usernameTracker.js',
  ));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  teardownTempDb(dbPath);
});

describe('normalizeUsername', () => {
  it('lowercases, strips punctuation, and drops trailing digits', () => {
    expect(normalizeUsername('Raider_01')).toBe('raider');
    expect(normalizeUsername('raider02')).toBe('raider');
  });

  it('returns an empty string for falsy input', () => {
    expect(normalizeUsername(null)).toBe('');
    expect(normalizeUsername(undefined)).toBe('');
  });
});

describe('levenshteinDistance', () => {
  it('is 0 for identical strings', () => {
    expect(levenshteinDistance('raider', 'raider')).toBe(0);
  });

  it('counts a single substitution as distance 1', () => {
    expect(levenshteinDistance('raider', 'raiper')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });
});

describe('recordUsername', () => {
  it('returns 0 without recording when normalization yields an empty string', () => {
    expect(recordUsername('guild-a', '1234', 60, 2)).toBe(0);
    expect(recordUsername('guild-a', '', 60, 2)).toBe(0);
  });

  it('counts a single join as 1', () => {
    expect(recordUsername('guild-b', 'raider01', 60, 2)).toBe(1);
  });

  it('counts similar usernames (within the distance threshold) together', () => {
    const guildId = 'guild-c';
    recordUsername(guildId, 'raider01', 60, 2);
    recordUsername(guildId, 'raider02', 60, 2);
    expect(recordUsername(guildId, 'raiper03', 60, 2)).toBe(3);
  });

  it('does not count dissimilar usernames together', () => {
    const guildId = 'guild-d';
    recordUsername(guildId, 'raider01', 60, 2);
    expect(recordUsername(guildId, 'totallydifferentname', 60, 2)).toBe(1);
  });

  it('drops occurrences outside the trailing window', () => {
    const guildId = 'guild-e';
    recordUsername(guildId, 'raider01', 30, 2);
    vi.advanceTimersByTime(31_000);
    expect(recordUsername(guildId, 'raider02', 30, 2)).toBe(1);
  });

  it('tracks usernames independently per guild', () => {
    recordUsername('guild-f1', 'raider01', 60, 2);
    expect(recordUsername('guild-f2', 'raider01', 60, 2)).toBe(1);
  });
});
