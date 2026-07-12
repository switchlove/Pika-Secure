const db = require('./db');

// Retention ceiling for pruning, independent of any per-guild configured
// window (all current windows default well under this) — the sweeper prunes
// on a fixed schedule without needing to look up every guild's config first.
const RETENTION_MS = 24 * 60 * 60 * 1000;

const insertStmt = db.prepare(
  'INSERT INTO raid_signal_events (guild_id, kind, value, created_at) VALUES (?, ?, ?, ?)',
);
const countInWindowStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM raid_signal_events WHERE guild_id = ? AND kind = ? AND created_at > ?',
);
const countExactValueStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM raid_signal_events WHERE guild_id = ? AND kind = ? AND value = ? AND created_at > ?',
);
const getValuesStmt = db.prepare(
  'SELECT value, created_at FROM raid_signal_events WHERE guild_id = ? AND kind = ? AND created_at > ? ORDER BY created_at',
);
const pruneStmt = db.prepare('DELETE FROM raid_signal_events WHERE created_at < ?');

function insertEvent(guildId, kind, value, timestamp = Date.now()) {
  insertStmt.run(guildId, kind, value ?? null, timestamp);
}

function countInWindow(guildId, kind, cutoff) {
  return countInWindowStmt.get(guildId, kind, cutoff).n;
}

function countExactValueInWindow(guildId, kind, value, cutoff) {
  return countExactValueStmt.get(guildId, kind, value, cutoff).n;
}

function getValuesInWindow(guildId, kind, cutoff) {
  return getValuesStmt.all(guildId, kind, cutoff);
}

function pruneExpired(now = Date.now()) {
  pruneStmt.run(now - RETENTION_MS);
}

module.exports = {
  insertEvent,
  countInWindow,
  countExactValueInWindow,
  getValuesInWindow,
  pruneExpired,
};
