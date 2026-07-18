CREATE INDEX IF NOT EXISTS idx_pending_verifications_guild_state_updated
  ON pending_verifications (guild_id, state, updated_at);
