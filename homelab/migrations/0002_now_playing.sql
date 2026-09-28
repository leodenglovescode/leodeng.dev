CREATE TABLE IF NOT EXISTS now_playing (
  singleton   INTEGER PRIMARY KEY CHECK (singleton = 1),
  track_key   TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  artist      TEXT    NOT NULL,
  album       TEXT,
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  position_ms INTEGER NOT NULL CHECK (position_ms >= 0 AND position_ms <= duration_ms),
  artwork_key TEXT,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS now_playing_rate (
  name             TEXT PRIMARY KEY CHECK (name = 'artwork'),
  last_accepted_at INTEGER NOT NULL
) WITHOUT ROWID;
