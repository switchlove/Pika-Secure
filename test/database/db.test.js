import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let openDbs;

beforeEach(() => {
  dbPath = setupTempDb();
  openDbs = [];
  bustSrcRequireCache(require);
});

afterEach(() => {
  for (const db of openDbs) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  teardownTempDb(dbPath);
});

function columnNames(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((col) => col.name);
}

describe('db.js', () => {
  it('creates all three tables from schema.sql on a fresh file', () => {
    const db = require('../../src/database/db.js');
    openDbs.push(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(['guild_config', 'pending_verifications', 'audit_log']));
  });

  it('a fresh schema already has all migration-guard columns present', () => {
    const db = require('../../src/database/db.js');
    openDbs.push(db);
    const columns = columnNames(db, 'guild_config');
    expect(columns).toEqual(
      expect.arrayContaining([
        'honeypot_channel_id',
        'honeypot_message_id',
        'avatar_reuse_count_threshold',
        'avatar_reuse_window_seconds',
        'hard_captcha_risk_threshold',
        'admin_role_ids',
      ]),
    );
  });

  it('re-importing against the same file is idempotent (migration guards skip cleanly)', () => {
    const db1 = require('../../src/database/db.js');
    openDbs.push(db1);
    const columnsBefore = columnNames(db1, 'guild_config');
    db1.close();
    openDbs = [];

    bustSrcRequireCache(require);
    const db2 = require('../../src/database/db.js');
    openDbs.push(db2);
    const columnsAfter = columnNames(db2, 'guild_config');

    expect(columnsAfter).toEqual(columnsBefore);
  });

  it('adds missing columns via ALTER TABLE when loading an older pre-migration database', () => {
    const preDb = new DatabaseSync(dbPath);
    preDb.exec(`
      CREATE TABLE guild_config (
        guild_id                    TEXT PRIMARY KEY,
        unverified_role_id          TEXT,
        verified_role_id            TEXT,
        verification_channel_id     TEXT,
        mod_log_channel_id          TEXT,
        gate_message_id             TEXT,
        verification_timeout_min    INTEGER NOT NULL DEFAULT 15,
        min_account_age_days        INTEGER NOT NULL DEFAULT 7,
        join_burst_count_threshold  INTEGER NOT NULL DEFAULT 5,
        join_burst_window_seconds   INTEGER NOT NULL DEFAULT 60,
        captcha_risk_threshold      INTEGER NOT NULL DEFAULT 50,
        max_captcha_attempts        INTEGER NOT NULL DEFAULT 3,
        created_at                  INTEGER NOT NULL,
        updated_at                  INTEGER NOT NULL
      );
    `);
    preDb.close();

    const db = require('../../src/database/db.js');
    openDbs.push(db);
    const columns = columnNames(db, 'guild_config');
    expect(columns).toEqual(
      expect.arrayContaining([
        'honeypot_channel_id',
        'honeypot_message_id',
        'avatar_reuse_count_threshold',
        'avatar_reuse_window_seconds',
        'hard_captcha_risk_threshold',
        'admin_role_ids',
      ]),
    );
  });
});
