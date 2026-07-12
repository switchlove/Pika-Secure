const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { databasePath } = require('../config/env');
const { runMigrations } = require('./migrate');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

runMigrations(db, path.join(__dirname, 'migrations'));

module.exports = db;
