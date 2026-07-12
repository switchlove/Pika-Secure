import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations, loadMigrations } from '../../src/database/migrate.js';

let db;
let migrationsDir;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-migrations-'));
});

afterEach(() => {
  db.close();
  fs.rmSync(migrationsDir, { recursive: true, force: true });
});

function writeMigration(name, sql) {
  fs.writeFileSync(path.join(migrationsDir, name), sql);
}

function appliedIds() {
  return db
    .prepare('SELECT id FROM schema_migrations ORDER BY id')
    .all()
    .map((row) => row.id);
}

function columnNames(table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((col) => col.name);
}

describe('migrate.loadMigrations', () => {
  it('loads .sql files sorted by filename, ignoring non-.sql files', () => {
    writeMigration('002_second.sql', 'SELECT 1;');
    writeMigration('001_first.sql', 'SELECT 1;');
    writeMigration('README.md', 'not sql');

    const migrations = loadMigrations(migrationsDir);

    expect(migrations.map((m) => m.id)).toEqual(['001_first.sql', '002_second.sql']);
  });
});

describe('migrate.runMigrations', () => {
  it('applies pending migrations in order and records each as applied', () => {
    writeMigration('001_create.sql', 'CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT);');
    writeMigration('002_add_col.sql', 'ALTER TABLE t ADD COLUMN b TEXT;');

    runMigrations(db, migrationsDir);

    expect(columnNames('t')).toEqual(['id', 'a', 'b']);
    expect(appliedIds()).toEqual(['001_create.sql', '002_add_col.sql']);
  });

  it('is idempotent: re-running with no new migration files applies nothing new', () => {
    writeMigration('001_create.sql', 'CREATE TABLE t (id INTEGER PRIMARY KEY);');

    runMigrations(db, migrationsDir);
    runMigrations(db, migrationsDir);

    expect(appliedIds()).toEqual(['001_create.sql']);
  });

  it('only runs migrations added since the last run', () => {
    writeMigration('001_create.sql', 'CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT);');
    runMigrations(db, migrationsDir);

    writeMigration('002_add_col.sql', 'ALTER TABLE t ADD COLUMN b TEXT;');
    runMigrations(db, migrationsDir);

    expect(columnNames('t')).toEqual(['id', 'a', 'b']);
    expect(appliedIds()).toEqual(['001_create.sql', '002_add_col.sql']);
  });

  it('tolerates a column that already exists, e.g. a database upgraded from the old ad-hoc ALTER guards', () => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)');
    writeMigration('001_add_col.sql', 'ALTER TABLE t ADD COLUMN a TEXT;');

    expect(() => runMigrations(db, migrationsDir)).not.toThrow();

    expect(columnNames('t')).toEqual(['id', 'a']);
    expect(appliedIds()).toEqual(['001_add_col.sql']);
  });

  it('rolls back and rethrows on a genuine migration error, without marking it applied', () => {
    writeMigration('001_bad.sql', 'NOT VALID SQL;');

    expect(() => runMigrations(db, migrationsDir)).toThrow(/syntax error/);

    expect(appliedIds()).toEqual([]);
  });

  it('stops at the first genuine error and does not apply later migrations', () => {
    writeMigration('001_bad.sql', 'NOT VALID SQL;');
    writeMigration('002_create.sql', 'CREATE TABLE t (id INTEGER PRIMARY KEY);');

    expect(() => runMigrations(db, migrationsDir)).toThrow();

    expect(appliedIds()).toEqual([]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t'").get(),
    ).toBeUndefined();
  });
});
