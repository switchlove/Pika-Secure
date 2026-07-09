const db = require('./db');

const insertDefaultsStmt = db.prepare(`
  INSERT OR IGNORE INTO guild_config (guild_id, created_at, updated_at)
  VALUES (?, ?, ?)
`);

const selectStmt = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?');

function ensureGuildConfig(guildId) {
  const now = Date.now();
  insertDefaultsStmt.run(guildId, now, now);
}

function parseRow(row) {
  if (!row) return row;
  return { ...row, admin_role_ids: row.admin_role_ids ? JSON.parse(row.admin_role_ids) : [] };
}

function getGuildConfig(guildId) {
  ensureGuildConfig(guildId);
  return parseRow(selectStmt.get(guildId));
}

const ALLOWED_FIELDS = new Set([
  'unverified_role_id',
  'verified_role_id',
  'verification_channel_id',
  'mod_log_channel_id',
  'welcome_channel_id',
  'welcome_message',
  'honeypot_channel_id',
  'honeypot_message_id',
  'gate_message_id',
  'verification_timeout_min',
  'min_account_age_days',
  'join_burst_count_threshold',
  'join_burst_window_seconds',
  'captcha_risk_threshold',
  'max_captcha_attempts',
  'avatar_reuse_count_threshold',
  'avatar_reuse_window_seconds',
  'hard_captcha_risk_threshold',
  'admin_role_ids',
]);

function updateGuildConfig(guildId, fields) {
  ensureGuildConfig(guildId);
  const entries = Object.entries(fields)
    .filter(([key, value]) => ALLOWED_FIELDS.has(key) && value !== undefined)
    .map(([key, value]) => (key === 'admin_role_ids' && Array.isArray(value) ? [key, JSON.stringify(value)] : [key, value]));
  if (entries.length === 0) return getGuildConfig(guildId);

  const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  db.prepare(`UPDATE guild_config SET ${setClause}, updated_at = ? WHERE guild_id = ?`).run(
    ...values,
    Date.now(),
    guildId,
  );
  return getGuildConfig(guildId);
}

module.exports = { getGuildConfig, updateGuildConfig };
