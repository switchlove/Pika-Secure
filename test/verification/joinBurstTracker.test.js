import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import tracker from '../../src/verification/joinBurstTracker.js';

const { recordJoin } = tracker;

describe('recordJoin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
