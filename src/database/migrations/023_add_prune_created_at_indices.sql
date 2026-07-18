CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_raid_signal_events_created_at ON raid_signal_events (created_at);
