CREATE TABLE IF NOT EXISTS daily_ai_chat_usage (
  day TEXT NOT NULL,
  ip TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  job TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, ip, slot)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS daily_ai_whitelist (
  ip TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
DROP TABLE IF EXISTS daily_ai_batch;
DROP TABLE IF EXISTS daily_ai_reads;
DROP TABLE IF EXISTS daily_ai_live_reads;
