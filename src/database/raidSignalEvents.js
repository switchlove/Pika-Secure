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
const getRecentValuesStmt = db.prepare(
  'SELECT value, created_at FROM raid_signal_events WHERE guild_id = ? AND kind = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?',
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

// Same as getValuesInWindow, but bounded to the most recent `limit` rows — a defensive cap for
// callers that do O(n) pairwise comparisons (Levenshtein/Hamming distance) across every row in
// the window, so a pathologically large raid burst can't turn one join into an unbounded amount
// of work. Still returned oldest-first, matching getValuesInWindow's ordering.
function getRecentValuesInWindow(guildId, kind, cutoff, limit) {
  return getRecentValuesStmt.all(guildId, kind, cutoff, limit).reverse();
}

function pruneExpired(now = Date.now()) {
  pruneStmt.run(now - RETENTION_MS);
}

function deleteAllForGuild(guildId) {
  db.prepare('DELETE FROM raid_signal_events WHERE guild_id = ?').run(guildId);
}

module.exports = {
  insertEvent,
  countInWindow,
  countExactValueInWindow,
  getValuesInWindow,
  getRecentValuesInWindow,
  pruneExpired,
  deleteAllForGuild,
};
