import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let pendingVerifications;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  pendingVerifications = require('../../src/database/pendingVerifications.js');
});

afterEach(() => {
  db.close();
  teardownTempDb(dbPath);
});

describe('createPendingVerification', () => {
  it('inserts a new pending record', () => {
    const record = pendingVerifications.createPendingVerification({
      guildId: 'g1',
      userId: 'u1',
      riskScore: 20,
      riskReasons: ['reason'],
      deadlineAt: 1000,
      joinedAt: 500,
    });
    expect(record.state).toBe('pending');
    expect(record.risk_score).toBe(20);
    expect(JSON.parse(record.risk_reasons)).toEqual(['reason']);
    expect(record.captcha_attempts).toBe(0);
  });

  it('resets state and clears captcha progress on conflict (rejoin)', () => {
    const first = pendingVerifications.createPendingVerification({
      guildId: 'g1',
      userId: 'u1',
      riskScore: 80,
      riskReasons: ['risky'],
      deadlineAt: 1000,
      joinedAt: 500,
    });
    pendingVerifications.escalateToCaptcha('g1', 'u1', 'ABC123');
    pendingVerifications.recordCaptchaFailure('g1', 'u1', 'DEF456', false);
    const midway = pendingVerifications.getPendingVerification('g1', 'u1');
    expect(midway.state).toBe('captcha');
    expect(midway.captcha_answer).toBe('DEF456');
    expect(midway.captcha_attempts).toBe(1);

    const rejoined = pendingVerifications.createPendingVerification({
      guildId: 'g1',
      userId: 'u1',
      riskScore: 10,
      riskReasons: ['low now'],
      deadlineAt: 2000,
      joinedAt: 1500,
    });

    expect(rejoined.id).toBe(first.id);
    expect(rejoined.state).toBe('pending');
    expect(rejoined.risk_score).toBe(10);
    expect(JSON.parse(rejoined.risk_reasons)).toEqual(['low now']);
    expect(rejoined.captcha_answer).toBeNull();
    expect(rejoined.captcha_attempts).toBe(0);
    expect(rejoined.deadline_at).toBe(2000);
    expect(rejoined.joined_at).toBe(1500);
  });
});

describe('getPendingVerification', () => {
  it('returns undefined for a non-existent record', () => {
    expect(pendingVerifications.getPendingVerification('nope', 'nope')).toBeUndefined();
  });

  it('returns the record for an existing (guildId, userId) pair', () => {
    pendingVerifications.createPendingVerification({
      guildId: 'g1',
      userId: 'u1',
      riskScore: 0,
      riskReasons: [],
      deadlineAt: 1,
      joinedAt: 1,
    });
    expect(pendingVerifications.getPendingVerification('g1', 'u1')).toBeDefined();
  });
});

describe('state transition helpers', () => {
  beforeEach(() => {
    pendingVerifications.createPendingVerification({
      guildId: 'g1',
      userId: 'u1',
      riskScore: 50,
      riskReasons: [],
      deadlineAt: 1000,
      joinedAt: 500,
    });
  });

  it('markVerified sets state to verified', () => {
    pendingVerifications.markVerified('g1', 'u1');
    expect(pendingVerifications.getPendingVerification('g1', 'u1').state).toBe('verified');
  });

  it('escalateToCaptcha sets state to captcha with the given answer', () => {
    pendingVerifications.escalateToCaptcha('g1', 'u1', 'XYZ789');
    const record = pendingVerifications.getPendingVerification('g1', 'u1');
    expect(record.state).toBe('captcha');
    expect(record.captcha_answer).toBe('XYZ789');
  });

  it('recordCaptchaFailure increments attempts and keeps state=captcha when not flagged', () => {
    pendingVerifications.escalateToCaptcha('g1', 'u1', 'AAA111');
    pendingVerifications.recordCaptchaFailure('g1', 'u1', 'BBB222', false);
    let record = pendingVerifications.getPendingVerification('g1', 'u1');
    expect(record.state).toBe('captcha');
    expect(record.captcha_attempts).toBe(1);
    expect(record.captcha_answer).toBe('BBB222');

    pendingVerifications.recordCaptchaFailure('g1', 'u1', 'CCC333', false);
    record = pendingVerifications.getPendingVerification('g1', 'u1');
    expect(record.captcha_attempts).toBe(2);
  });

  it('recordCaptchaFailure sets state=flagged and allows a null answer when flagged', () => {
    pendingVerifications.escalateToCaptcha('g1', 'u1', 'AAA111');
    pendingVerifications.recordCaptchaFailure('g1', 'u1', null, true);
    const record = pendingVerifications.getPendingVerification('g1', 'u1');
    expect(record.state).toBe('flagged');
    expect(record.captcha_answer).toBeNull();
    expect(record.captcha_attempts).toBe(1);
  });

  it('markKicked transitions by numeric id, not guild/user', () => {
    const record = pendingVerifications.getPendingVerification('g1', 'u1');
    pendingVerifications.markKicked(record.id);
    expect(pendingVerifications.getPendingVerification('g1', 'u1').state).toBe('kicked');
  });
});

describe('findExpired', () => {
  function seed(userId, state, deadlineAt) {
    pendingVerifications.createPendingVerification({
      guildId: 'g1',
      userId,
      riskScore: 0,
      riskReasons: [],
      deadlineAt,
      joinedAt: 0,
    });
    if (state === 'captcha') pendingVerifications.escalateToCaptcha('g1', userId, 'X');
    if (state === 'flagged') {
      pendingVerifications.escalateToCaptcha('g1', userId, 'X');
      pendingVerifications.recordCaptchaFailure('g1', userId, null, true);
    }
    if (state === 'verified') pendingVerifications.markVerified('g1', userId);
    if (state === 'kicked') {
      const record = pendingVerifications.getPendingVerification('g1', userId);
      pendingVerifications.markKicked(record.id);
    }
  }

  it('includes pending/captcha/flagged records past their deadline', () => {
    seed('u-pending', 'pending', 100);
    seed('u-captcha', 'captcha', 100);
    seed('u-flagged', 'flagged', 100);

    const expired = pendingVerifications.findExpired(200).map((r) => r.user_id);
    expect(expired.sort()).toEqual(['u-captcha', 'u-flagged', 'u-pending']);
  });

  it('excludes verified and kicked records regardless of deadline', () => {
    seed('u-verified', 'verified', 100);
    seed('u-kicked', 'kicked', 100);

    expect(pendingVerifications.findExpired(200)).toEqual([]);
  });

  it('excludes records whose deadline has not yet passed', () => {
    seed('u-future', 'pending', 500);
    expect(pendingVerifications.findExpired(200)).toEqual([]);
  });

  it('includes a record exactly at the deadline boundary (<=)', () => {
    seed('u-boundary', 'pending', 200);
    const expired = pendingVerifications.findExpired(200);
    expect(expired).toHaveLength(1);
    expect(expired[0].user_id).toBe('u-boundary');
  });

  it('defaults now to Date.now() when not provided', () => {
    seed('u-now', 'pending', Date.now() - 1000);
    expect(pendingVerifications.findExpired().map((r) => r.user_id)).toContain('u-now');
  });
});
