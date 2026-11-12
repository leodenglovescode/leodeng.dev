CREATE TABLE IF NOT EXISTS now_playing_sources (
  source_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  source_label TEXT NOT NULL,
  priority INTEGER NOT NULL,
  playing INTEGER NOT NULL,
  track_key TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  duration_ms INTEGER,
  position_ms INTEGER,
  artwork_key TEXT,
  changed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS now_playing_sources_received ON now_playing_sources(received_at);
