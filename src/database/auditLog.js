const db = require('./db');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (guild_id, user_id, event_type, detail, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

function insertAuditLog(guildId, userId, eventType, detail) {
  insertStmt.run(guildId, userId || null, eventType, detail ? JSON.stringify(detail) : null, Date.now());
}

module.exports = { insertAuditLog };
