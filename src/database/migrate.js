const fs = require('node:fs');
const path = require('node:path');

const DUPLICATE_COLUMN_PREFIX = 'duplicate column name';

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    );
  `);
}

function loadMigrations(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({ id: file, sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8') }));
}

function isDuplicateColumnError(err) {
  return err.code === 'ERR_SQLITE_ERROR' && err.message.startsWith(DUPLICATE_COLUMN_PREFIX);
}

function runMigrations(db, migrationsDir) {
  ensureMigrationsTable(db);

  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => row.id),
  );
  const markApplied = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const migration of loadMigrations(migrationsDir)) {
    if (applied.has(migration.id)) continue;

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // A database that predates this migration runner may already have this exact
      // column, added by the old ad-hoc ALTER TABLE guards that used to live in
      // db.js. Treat "already has it" as success so upgrading an existing deployment
      // doesn't crash on startup; any other error is a real failure and propagates.
      if (!isDuplicateColumnError(err)) {
        throw err;
      }
    }
    markApplied.run(migration.id, Date.now());
  }
}

module.exports = { runMigrations, loadMigrations };
