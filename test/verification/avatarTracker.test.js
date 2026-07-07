import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import tracker from '../../src/verification/avatarTracker.js';

const { recordAvatar } = tracker;

describe('recordAvatar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
