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

const LATER_COLUMNS = [
  'honeypot_channel_id',
  'honeypot_message_id',
  'avatar_reuse_count_threshold',
  'avatar_reuse_window_seconds',
  'hard_captcha_risk_threshold',
  'admin_role_ids',
  'welcome_channel_id',
  'welcome_message',
  'perceptual_avatar_hamming_threshold',
  'username_similarity_count_threshold',
  'username_similarity_window_seconds',
  'username_similarity_distance_threshold',
  'fast_solve_count_threshold',
  'fast_solve_window_seconds',
  'captcha_type',
];

const BASE_GUILD_CONFIG_SQL = `
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
`;

describe('db.js', () => {
  it('creates all three tables via migrations on a fresh file', () => {
    const db = require('../../src/database/db.js');
    openDbs.push(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining(['guild_config', 'pending_verifications', 'audit_log']),
    );
  });

  it('records every migration as applied on a fresh file', () => {
    const db = require('../../src/database/db.js');
    openDbs.push(db);
    const applied = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all()
      .map((row) => row.id);
    expect(applied).toEqual([
      '001_initial_schema.sql',
      '002_add_honeypot_channel_id.sql',
      '003_add_honeypot_message_id.sql',
      '004_add_avatar_reuse_count_threshold.sql',
      '005_add_avatar_reuse_window_seconds.sql',
      '006_add_hard_captcha_risk_threshold.sql',
      '007_add_admin_role_ids.sql',
      '008_add_welcome_channel_id.sql',
      '009_add_welcome_message.sql',
      '010_add_perceptual_avatar_hamming_threshold.sql',
      '011_add_username_similarity_count_threshold.sql',
      '012_add_username_similarity_window_seconds.sql',
      '013_add_username_similarity_distance_threshold.sql',
      '014_add_raid_signal_events.sql',
      '015_add_fast_solve_count_threshold.sql',
      '016_add_fast_solve_window_seconds.sql',
      '017_add_captcha_type_guild_config.sql',
      '018_add_captcha_type_pending_verifications.sql',
      '019_add_audit_log_index.sql',
      '020_add_honeypot_bait_message.sql',
      '021_add_raid_lockdown.sql',
    ]);
  });

  it('a fresh schema already has all later-added columns present', () => {
    const db = require('../../src/database/db.js');
    openDbs.push(db);
    expect(columnNames(db, 'guild_config')).toEqual(expect.arrayContaining(LATER_COLUMNS));
  });

  it('re-importing against the same file is idempotent (already-applied migrations are skipped)', () => {
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

  it('adds missing columns via migration when loading a database that predates all of them', () => {
    const preDb = new DatabaseSync(dbPath);
    preDb.exec(BASE_GUILD_CONFIG_SQL);
    preDb.close();

    const db = require('../../src/database/db.js');
    openDbs.push(db);
    expect(columnNames(db, 'guild_config')).toEqual(expect.arrayContaining(LATER_COLUMNS));
  });

  it('reconciles a database that already has every column from the old ad-hoc ALTER guards but no schema_migrations table', () => {
    const preDb = new DatabaseSync(dbPath);
    preDb.exec(BASE_GUILD_CONFIG_SQL);
    for (const column of [
      'honeypot_channel_id TEXT',
      'honeypot_message_id TEXT',
      'avatar_reuse_count_threshold INTEGER NOT NULL DEFAULT 3',
      'avatar_reuse_window_seconds INTEGER NOT NULL DEFAULT 300',
      'hard_captcha_risk_threshold INTEGER NOT NULL DEFAULT 75',
      "admin_role_ids TEXT NOT NULL DEFAULT '[]'",
      'welcome_channel_id TEXT',
      'welcome_message TEXT',
    ]) {
      preDb.exec(`ALTER TABLE guild_config ADD COLUMN ${column}`);
    }
    preDb.close();

    const db = require('../../src/database/db.js');
    openDbs.push(db);

    expect(columnNames(db, 'guild_config')).toEqual(expect.arrayContaining(LATER_COLUMNS));
    const applied = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all()
      .map((row) => row.id);
    expect(applied).toHaveLength(21);
  });
});
