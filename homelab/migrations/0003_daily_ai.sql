-- Apply to the existing HOMELAB_DB. Starts disabled until explicitly enabled.
CREATE TABLE IF NOT EXISTS daily_ai_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO daily_ai_control (singleton) VALUES (1);

-- Only the latest complete, validated batch is stored. No partial publication.
CREATE TABLE IF NOT EXISTS daily_ai_batch (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  answers TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_ai_bans (
  ip TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS daily_ai_bans_created ON daily_ai_bans (created_at DESC, ip);
CREATE TABLE IF NOT EXISTS daily_ai_reads (
  day TEXT NOT NULL,
  ip TEXT NOT NULL,
  question_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, ip)
) WITHOUT ROWID;
