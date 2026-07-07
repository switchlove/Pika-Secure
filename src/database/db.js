const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { databasePath } = require('../config/env');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const guildConfigColumns = db.prepare('PRAGMA table_info(guild_config)').all();
if (!guildConfigColumns.some((col) => col.name === 'honeypot_channel_id')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN honeypot_channel_id TEXT');
}
if (!guildConfigColumns.some((col) => col.name === 'honeypot_message_id')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN honeypot_message_id TEXT');
}
if (!guildConfigColumns.some((col) => col.name === 'avatar_reuse_count_threshold')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN avatar_reuse_count_threshold INTEGER NOT NULL DEFAULT 3');
}
if (!guildConfigColumns.some((col) => col.name === 'avatar_reuse_window_seconds')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN avatar_reuse_window_seconds INTEGER NOT NULL DEFAULT 300');
}
if (!guildConfigColumns.some((col) => col.name === 'hard_captcha_risk_threshold')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN hard_captcha_risk_threshold INTEGER NOT NULL DEFAULT 75');
}
if (!guildConfigColumns.some((col) => col.name === 'admin_role_ids')) {
  db.exec("ALTER TABLE guild_config ADD COLUMN admin_role_ids TEXT NOT NULL DEFAULT '[]'");
}

module.exports = db;
