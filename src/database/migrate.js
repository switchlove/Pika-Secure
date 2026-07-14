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

// Splits a migration file into individual statements so each can be tried (and, for a duplicate
// column, tolerated) on its own. These migrations are plain DDL with no string literals, so a
// naive split on ';' is safe.
function splitStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
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
      for (const statement of splitStatements(migration.sql)) {
        try {
          db.exec(statement);
        } catch (err) {
          // A database that predates this migration runner may already have this exact
          // column, added by the old ad-hoc ALTER TABLE guards that used to live in db.js.
          // Treat "already has it" as success on a per-statement basis so the rest of a
          // multi-statement migration file still applies, rather than letting one already-
          // applied ALTER roll back the whole file; any other error is a real failure and
          // propagates, aborting and rolling back the migration.
          if (!isDuplicateColumnError(err)) {
            throw err;
          }
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    markApplied.run(migration.id, Date.now());
  }
}

module.exports = { runMigrations, loadMigrations };
