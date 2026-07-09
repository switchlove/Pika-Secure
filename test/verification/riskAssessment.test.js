import { describe, it, expect } from 'vitest';
import riskAssessment from '../../src/verification/riskAssessment.js';

const { computeRiskScore } = riskAssessment;

const DAY_MS = 24 * 60 * 60 * 1000;

function makeMember({
  accountAgeDays = 365,
  avatar = 'some-hash',
  username = 'normaluser',
  flags = [],
  hasFlags = true,
} = {}) {
  return {
    user: {
      createdTimestamp: Date.now() - accountAgeDays * DAY_MS,
      avatar,
      username,
      flags: hasFlags ? { toArray: () => flags } : undefined,
    },
  };
}

function makeGuildConfig(overrides = {}) {
  return {
    min_account_age_days: 7,
    join_burst_count_threshold: 5,
    join_burst_window_seconds: 60,
    avatar_reuse_count_threshold: 3,
    avatar_reuse_window_seconds: 60,
    ...overrides,
  };
}

describe('computeRiskScore', () => {
  it('returns a zero score with no risk factors', () => {
    const result = computeRiskScore(makeMember(), makeGuildConfig(), 1, 0);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual(['No risk factors detected']);
  });

  it('penalizes accounts younger than the configured threshold', () => {
    const result = computeRiskScore(
      makeMember({ accountAgeDays: 0 }),
      makeGuildConfig({ min_account_age_days: 7 }),
      1,
      0,
    );
    expect(result.score).toBe(40);
    expect(result.reasons[0]).toMatch(/Account is 0.0 days old/);
  });

  it('scales the account-age penalty proportionally under the threshold', () => {
    const result = computeRiskScore(
      makeMember({ accountAgeDays: 3.5 }),
      makeGuildConfig({ min_account_age_days: 7 }),
      1,
      0,
    );
    // 40 * (1 - 3.5/7) = 20
    expect(result.score).toBe(20);
  });

  it('does not penalize accounts older than the threshold', () => {
    const result = computeRiskScore(
      makeMember({ accountAgeDays: 30 }),
      makeGuildConfig({ min_account_age_days: 7 }),
      1,
      0,
    );
    expect(result.score).toBe(0);
  });

  it('penalizes missing avatars', () => {
    const result = computeRiskScore(makeMember({ avatar: null }), makeGuildConfig(), 1, 0);
    expect(result.score).toBe(25);
    expect(result.reasons).toContain('No custom avatar — +25');
  });

  it('penalizes join bursts above the threshold', () => {
    const result = computeRiskScore(makeMember(), makeGuildConfig({ join_burst_count_threshold: 5 }), 6, 0);
    expect(result.score).toBe(35);
  });

  it('does not penalize join counts at or below the threshold', () => {
    const result = computeRiskScore(makeMember(), makeGuildConfig({ join_burst_count_threshold: 5 }), 5, 0);
    expect(result.score).toBe(0);
  });

  it('penalizes duplicate avatars above the threshold when an avatar is set', () => {
    const result = computeRiskScore(
      makeMember({ avatar: 'hash' }),
      makeGuildConfig({ avatar_reuse_count_threshold: 3 }),
      1,
      4,
    );
    expect(result.score).toBe(30);
  });

  it('ignores duplicate avatar reuse count when the member has no avatar', () => {
    const result = computeRiskScore(
      makeMember({ avatar: null }),
      makeGuildConfig({ avatar_reuse_count_threshold: 3 }),
      1,
      10,
    );
    // Only the no-avatar penalty should apply, not the duplicate-avatar one.
    expect(result.score).toBe(25);
  });

  it('penalizes usernames matching the bot-generated pattern', () => {
    const result = computeRiskScore(makeMember({ username: 'user48213' }), makeGuildConfig(), 1, 0);
    expect(result.score).toBe(15);
  });

  it('does not penalize usernames that only partially resemble the pattern', () => {
    const result = computeRiskScore(makeMember({ username: 'user482' }), makeGuildConfig(), 1, 0);
    expect(result.score).toBe(0);
  });

  it('discounts the score for trusted badges', () => {
    const result = computeRiskScore(
      makeMember({ accountAgeDays: 0, flags: ['Staff'] }),
      makeGuildConfig({ min_account_age_days: 7 }),
      1,
      0,
    );
    expect(result.score).toBe(20); // 40 - 20
    expect(result.reasons.some((r) => r.includes('trusted public badge'))).toBe(true);
  });

  it('treats a missing flags object (e.g. an uncached/partial user) as no badges', () => {
    const result = computeRiskScore(makeMember({ hasFlags: false }), makeGuildConfig(), 1, 0);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual(['No risk factors detected']);
  });

  it('clamps the score at 0 when discounts would push it negative', () => {
    const result = computeRiskScore(makeMember({ flags: ['Staff'] }), makeGuildConfig(), 1, 0);
    expect(result.score).toBe(0);
  });

  it('clamps the score at 100 when many factors stack', () => {
    const result = computeRiskScore(
      makeMember({ accountAgeDays: 0, avatar: null, username: 'user48213' }),
      makeGuildConfig({ min_account_age_days: 7, join_burst_count_threshold: 1 }),
      10,
      0,
    );
    expect(result.score).toBe(100);
  });

  it('accumulates multiple reasons together', () => {
    const result = computeRiskScore(
      makeMember({ accountAgeDays: 0, avatar: null }),
      makeGuildConfig({ min_account_age_days: 7 }),
      1,
      0,
    );
    expect(result.reasons).toHaveLength(2);
  });
});
