const db = require('./db');

const upsertStmt = db.prepare(`
  INSERT INTO pending_verifications
    (guild_id, user_id, state, risk_score, risk_reasons, captcha_attempts, deadline_at, joined_at, created_at, updated_at)
  VALUES
    (?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    state = 'pending',
    risk_score = excluded.risk_score,
    risk_reasons = excluded.risk_reasons,
    captcha_answer = NULL,
    captcha_attempts = 0,
    deadline_at = excluded.deadline_at,
    joined_at = excluded.joined_at,
    updated_at = excluded.updated_at
`);

const getStmt = db.prepare(
  'SELECT * FROM pending_verifications WHERE guild_id = ? AND user_id = ?',
);

const findExpiredStmt = db.prepare(`
  SELECT * FROM pending_verifications
  WHERE state IN ('pending', 'captcha', 'flagged') AND deadline_at <= ?
`);

function createPendingVerification({ guildId, userId, riskScore, riskReasons, deadlineAt, joinedAt }) {
  const now = Date.now();
  upsertStmt.run(
    guildId,
    userId,
    riskScore,
    JSON.stringify(riskReasons),
    deadlineAt,
    joinedAt,
    now,
    now,
  );
  return getStmt.get(guildId, userId);
}

function getPendingVerification(guildId, userId) {
  return getStmt.get(guildId, userId);
}

function markVerified(guildId, userId) {
  db.prepare(
    "UPDATE pending_verifications SET state = 'verified', updated_at = ? WHERE guild_id = ? AND user_id = ?",
  ).run(Date.now(), guildId, userId);
}

function escalateToCaptcha(guildId, userId, captchaAnswer) {
  db.prepare(
    `UPDATE pending_verifications
     SET state = 'captcha', captcha_answer = ?, updated_at = ?
     WHERE guild_id = ? AND user_id = ?`,
  ).run(captchaAnswer, Date.now(), guildId, userId);
}

function recordCaptchaFailure(guildId, userId, nextAnswer, flagged) {
  db.prepare(
    `UPDATE pending_verifications
     SET state = ?, captcha_answer = ?, captcha_attempts = captcha_attempts + 1, updated_at = ?
     WHERE guild_id = ? AND user_id = ?`,
  ).run(flagged ? 'flagged' : 'captcha', nextAnswer, Date.now(), guildId, userId);
}

function markKicked(id) {
  db.prepare("UPDATE pending_verifications SET state = 'kicked', updated_at = ? WHERE id = ?").run(
    Date.now(),
    id,
  );
}

function findExpired(now = Date.now()) {
  return findExpiredStmt.all(now);
}

module.exports = {
  createPendingVerification,
  getPendingVerification,
  markVerified,
  escalateToCaptcha,
  recordCaptchaFailure,
  markKicked,
  findExpired,
};
