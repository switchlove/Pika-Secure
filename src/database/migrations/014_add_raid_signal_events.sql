CREATE TABLE IF NOT EXISTS raid_signal_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  value       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raid_signal_events_lookup
  ON raid_signal_events (guild_id, kind, created_at);
