const db = require('./db');

const MAX_QUERY_LIMIT = 50;
const DEFAULT_QUERY_LIMIT = 20;

// Unlike raid_signal_events (pruned to a 24h TTL every sweep), audit log entries are kept much
// longer since they're the durable record moderators review via `/setup review log` — but still
// pruned eventually so the table and its index don't grow forever on a long-lived deployment.
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const insertStmt = db.prepare(`
  INSERT INTO audit_log (guild_id, user_id, event_type, detail, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const pruneStmt = db.prepare('DELETE FROM audit_log WHERE created_at < ?');

function insertAuditLog(guildId, userId, eventType, detail) {
  insertStmt.run(
    guildId,
    userId || null,
    eventType,
    detail ? JSON.stringify(detail) : null,
    Date.now(),
  );
}

function queryAuditLog(guildId, { eventType, userId, limit = DEFAULT_QUERY_LIMIT } = {}) {
  const clauses = ['guild_id = ?'];
  const params = [guildId];

  if (eventType) {
    clauses.push('event_type = ?');
    params.push(eventType);
  }
  if (userId) {
    clauses.push('user_id = ?');
    params.push(userId);
  }

  const cappedLimit = Math.min(Math.max(1, limit), MAX_QUERY_LIMIT);
  params.push(cappedLimit);

  return db
    .prepare(
      `SELECT * FROM audit_log WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
}

function pruneExpired(now = Date.now()) {
  pruneStmt.run(now - RETENTION_MS);
}

function deleteAllForGuild(guildId) {
  db.prepare('DELETE FROM audit_log WHERE guild_id = ?').run(guildId);
}

module.exports = { insertAuditLog, queryAuditLog, pruneExpired, deleteAllForGuild };
