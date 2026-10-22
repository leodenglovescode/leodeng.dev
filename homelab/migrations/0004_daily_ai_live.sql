CREATE TABLE IF NOT EXISTS daily_ai_live_reads (
  day TEXT NOT NULL,
  ip TEXT NOT NULL,
  question_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, ip)
) WITHOUT ROWID;
