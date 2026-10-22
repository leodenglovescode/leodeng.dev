CREATE TABLE daily_ai_live_reads_v2 (
  day TEXT NOT NULL,
  ip TEXT NOT NULL,
  request_no INTEGER NOT NULL CHECK (request_no BETWEEN 1 AND 5),
  question_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, ip, request_no)
) WITHOUT ROWID;
INSERT INTO daily_ai_live_reads_v2 (day, ip, request_no, question_id, job_id, created_at)
  SELECT day, ip, 1, question_id, job_id, created_at FROM daily_ai_live_reads;
DROP TABLE daily_ai_live_reads;
ALTER TABLE daily_ai_live_reads_v2 RENAME TO daily_ai_live_reads;
