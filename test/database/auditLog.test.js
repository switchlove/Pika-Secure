import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let insertAuditLog;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  ({ insertAuditLog } = require('../../src/database/auditLog.js'));
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
