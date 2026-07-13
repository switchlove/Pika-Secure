import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let insertAuditLog;
let queryAuditLog;
let pruneExpired;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  ({ insertAuditLog, queryAuditLog, pruneExpired } = require('../../src/database/auditLog.js'));
});

afterEach(() => {
  db.close();
  teardownTempDb(dbPath);
});

function readAllAuditLogs() {
  return db.prepare('SELECT * FROM audit_log ORDER BY id').all();
}

describe('insertAuditLog', () => {
  it('inserts a row with JSON-stringified detail', () => {
    insertAuditLog('guild-1', 'user-1', 'joined', { score: 42, reasons: ['a', 'b'] });
    const rows = readAllAuditLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guild_id: 'guild-1', user_id: 'user-1', event_type: 'joined' });
    expect(JSON.parse(rows[0].detail)).toEqual({ score: 42, reasons: ['a', 'b'] });
    expect(rows[0].created_at).toBeTypeOf('number');
  });

  it('stores NULL (not the string "null") when detail is falsy', () => {
    insertAuditLog('guild-1', 'user-1', 'auto_kicked', undefined);
    const rows = readAllAuditLogs();
    expect(rows[0].detail).toBeNull();
  });

  it('stores NULL when detail is null', () => {
    insertAuditLog('guild-1', 'user-1', 'captcha_escalated', null);
    const rows = readAllAuditLogs();
    expect(rows[0].detail).toBeNull();
  });

  it('falls back userId to null when falsy', () => {
    insertAuditLog('guild-1', undefined, 'auto_kicked', { note: 'no user' });
    const rows = readAllAuditLogs();
    expect(rows[0].user_id).toBeNull();
  });

  it('falls back userId to null for an empty string', () => {
    insertAuditLog('guild-1', '', 'auto_kicked', null);
    const rows = readAllAuditLogs();
    expect(rows[0].user_id).toBeNull();
  });
});

describe('queryAuditLog', () => {
  it('isolates results by guild', () => {
    insertAuditLog('guild-1', 'user-1', 'joined', null);
    insertAuditLog('guild-2', 'user-1', 'joined', null);
    expect(queryAuditLog('guild-1')).toHaveLength(1);
  });

  it('filters by eventType when provided', () => {
    insertAuditLog('guild-1', 'user-1', 'joined', null);
    insertAuditLog('guild-1', 'user-1', 'verified', null);
    const rows = queryAuditLog('guild-1', { eventType: 'verified' });
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('verified');
  });

  it('filters by userId when provided', () => {
    insertAuditLog('guild-1', 'user-1', 'joined', null);
    insertAuditLog('guild-1', 'user-2', 'joined', null);
    const rows = queryAuditLog('guild-1', { userId: 'user-2' });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('user-2');
  });

  it('orders results by created_at descending', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      insertAuditLog('guild-1', 'user-1', 'first', null);
      vi.setSystemTime(2000);
      insertAuditLog('guild-1', 'user-1', 'second', null);
      vi.setSystemTime(3000);
      insertAuditLog('guild-1', 'user-1', 'third', null);
    } finally {
      vi.useRealTimers();
    }
    const rows = queryAuditLog('guild-1');
    expect(rows.map((r) => r.event_type)).toEqual(['third', 'second', 'first']);
  });

  it('respects the limit and defaults to 20', () => {
    for (let i = 0; i < 5; i++) insertAuditLog('guild-1', 'user-1', `event-${i}`, null);
    expect(queryAuditLog('guild-1', { limit: 2 })).toHaveLength(2);
    expect(queryAuditLog('guild-1')).toHaveLength(5);
  });

  it('caps the limit at 50 even if a larger value is requested', () => {
    for (let i = 0; i < 5; i++) insertAuditLog('guild-1', 'user-1', `event-${i}`, null);
    expect(queryAuditLog('guild-1', { limit: 1000 })).toHaveLength(5);
  });

  it('returns an empty array when nothing matches', () => {
    expect(queryAuditLog('guild-empty')).toEqual([]);
  });
});

describe('pruneExpired', () => {
  it('removes rows older than the retention ceiling and keeps newer ones', () => {
    const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
    const now = RETENTION_MS + 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now - RETENTION_MS - 60_000); // just past retention
      insertAuditLog('guild-1', 'user-1', 'old-event', null);
      vi.setSystemTime(now - 60_000); // well within retention
      insertAuditLog('guild-1', 'user-1', 'recent-event', null);
      vi.setSystemTime(now);
    } finally {
      vi.useRealTimers();
    }

    pruneExpired(now);

    const rows = queryAuditLog('guild-1');
    expect(rows.map((r) => r.event_type)).toEqual(['recent-event']);
  });

  it('defaults now to Date.now() when not provided', () => {
    insertAuditLog('guild-1', 'user-1', 'fresh-event', null);
    expect(() => pruneExpired()).not.toThrow();
    expect(queryAuditLog('guild-1')).toHaveLength(1);
  });
});
