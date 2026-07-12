const db = require('./db');

const MAX_QUERY_LIMIT = 50;
const DEFAULT_QUERY_LIMIT = 20;

const insertStmt = db.prepare(`
  INSERT INTO audit_log (guild_id, user_id, event_type, detail, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

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

module.exports = { insertAuditLog, queryAuditLog };
