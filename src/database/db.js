const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { databasePath } = require('../config/env');
const { runMigrations } = require('./migrate');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
// Without this, a second process opening the DB while another holds a write lock gets an
// immediate SQLITE_BUSY instead of waiting — e.g. two shard processes starting close together can
// both hit runMigrations()'s BEGIN/COMMIT transaction lock. 5000ms matches the shutdown-timeout
// convention in utils/shutdown.js and is far longer than a migration transaction should ever need.
db.exec('PRAGMA busy_timeout = 5000;');

runMigrations(db, path.join(__dirname, 'migrations'));

module.exports = db;
