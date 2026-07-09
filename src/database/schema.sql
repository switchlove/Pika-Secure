CREATE TABLE IF NOT EXISTS guild_config (
  guild_id                    TEXT PRIMARY KEY,
  unverified_role_id          TEXT,
  verified_role_id            TEXT,
  verification_channel_id     TEXT,
  mod_log_channel_id          TEXT,
  welcome_channel_id          TEXT,
  welcome_message             TEXT,
  honeypot_channel_id         TEXT,
  honeypot_message_id         TEXT,
  gate_message_id             TEXT,
  verification_timeout_min    INTEGER NOT NULL DEFAULT 15,
  min_account_age_days        INTEGER NOT NULL DEFAULT 7,
  join_burst_count_threshold  INTEGER NOT NULL DEFAULT 5,
  join_burst_window_seconds   INTEGER NOT NULL DEFAULT 60,
  captcha_risk_threshold      INTEGER NOT NULL DEFAULT 50,
  max_captcha_attempts        INTEGER NOT NULL DEFAULT 3,
  avatar_reuse_count_threshold INTEGER NOT NULL DEFAULT 3,
  avatar_reuse_window_seconds INTEGER NOT NULL DEFAULT 300,
  hard_captcha_risk_threshold INTEGER NOT NULL DEFAULT 75,
  admin_role_ids              TEXT NOT NULL DEFAULT '[]',
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_verifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('pending','captcha','verified','kicked','flagged')) DEFAULT 'pending',
  risk_score        INTEGER NOT NULL DEFAULT 0,
  risk_reasons      TEXT,
  captcha_answer    TEXT,
  captcha_attempts  INTEGER NOT NULL DEFAULT 0,
  deadline_at       INTEGER NOT NULL,
  joined_at         INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pending_sweep
  ON pending_verifications (state, deadline_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT,
  event_type  TEXT NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
