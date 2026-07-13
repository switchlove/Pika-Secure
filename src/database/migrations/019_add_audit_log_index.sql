CREATE INDEX IF NOT EXISTS idx_audit_log_guild_created
  ON audit_log (guild_id, created_at);
