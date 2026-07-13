ALTER TABLE guild_config ADD COLUMN raid_lockdown_join_count_threshold INTEGER;
ALTER TABLE guild_config ADD COLUMN raid_lockdown_duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE guild_config ADD COLUMN raid_lockdown_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guild_config ADD COLUMN raid_lockdown_expires_at INTEGER;
ALTER TABLE guild_config ADD COLUMN raid_lockdown_previous_verification_level INTEGER;
