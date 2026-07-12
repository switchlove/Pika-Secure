import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let recordAvatar;
let recordPerceptualHash;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  ({ recordAvatar, recordPerceptualHash } = require('../../src/verification/avatarTracker.js'));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  teardownTempDb(dbPath);
});

describe('recordAvatar', () => {
  it('returns 0 without recording when the avatar hash is falsy', () => {
    expect(recordAvatar('guild-a', null, 60)).toBe(0);
    expect(recordAvatar('guild-a', undefined, 60)).toBe(0);
    // Confirm nothing was recorded for this guild by checking a real hash starts at 1.
    expect(recordAvatar('guild-a', 'hash-1', 60)).toBe(1);
  });

  it('counts repeated occurrences of the same hash within the window', () => {
    const guildId = 'guild-b';
    expect(recordAvatar(guildId, 'hash-x', 60)).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(recordAvatar(guildId, 'hash-x', 60)).toBe(2);
  });

  it('tracks different hashes independently within the same guild', () => {
    const guildId = 'guild-c';
    recordAvatar(guildId, 'hash-x', 60);
    expect(recordAvatar(guildId, 'hash-y', 60)).toBe(1);
  });

  it('drops occurrences outside the trailing window', () => {
    const guildId = 'guild-d';
    recordAvatar(guildId, 'hash-x', 30);
    vi.advanceTimersByTime(31_000);
    expect(recordAvatar(guildId, 'hash-x', 30)).toBe(1);
  });

  it('tracks the same hash independently per guild', () => {
    recordAvatar('guild-e1', 'hash-shared', 60);
    expect(recordAvatar('guild-e2', 'hash-shared', 60)).toBe(1);
  });
});

describe('recordPerceptualHash', () => {
  it('returns 0 without recording when the hash is falsy', () => {
    expect(recordPerceptualHash('guild-a', null, 60, 10)).toBe(0);
    expect(recordPerceptualHash('guild-a', undefined, 60, 10)).toBe(0);
  });

  it('counts a single hash as 1', () => {
    expect(recordPerceptualHash('guild-b', '0000000000000000', 60, 10)).toBe(1);
  });

  it('counts near-duplicate hashes (within the Hamming threshold) together', () => {
    const guildId = 'guild-c';
    recordPerceptualHash(guildId, '0000000000000000', 60, 10);
    // '0000000000000001' differs by exactly 1 bit from the zero hash.
    expect(recordPerceptualHash(guildId, '0000000000000001', 60, 10)).toBe(2);
  });

  it('does not count hashes beyond the Hamming threshold together', () => {
    const guildId = 'guild-d';
    recordPerceptualHash(guildId, '0000000000000000', 60, 10);
    // 'ffffffffffffffff' differs by 64 bits from the zero hash.
    expect(recordPerceptualHash(guildId, 'ffffffffffffffff', 60, 10)).toBe(1);
  });

  it('drops occurrences outside the trailing window', () => {
    const guildId = 'guild-e';
    recordPerceptualHash(guildId, '0000000000000000', 30, 10);
    vi.advanceTimersByTime(31_000);
    expect(recordPerceptualHash(guildId, '0000000000000000', 30, 10)).toBe(1);
  });

  it('tracks hashes independently per guild', () => {
    recordPerceptualHash('guild-f1', '0000000000000000', 60, 10);
    expect(recordPerceptualHash('guild-f2', '0000000000000000', 60, 10)).toBe(1);
  });
});
