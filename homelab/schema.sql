-- D1 schema for the /homelab status page and the /tokens page.
--
--   npx wrangler d1 create leodeng-homelab
--   npx wrangler d1 execute leodeng-homelab --remote --file=homelab/schema.sql
--
-- Then bind it to the Pages project as HOMELAB_DB
-- (Settings -> Functions -> D1 database bindings).

-- One row per heartbeat. `ts` is unix seconds and is assigned by the Function,
-- never by the agent: a homelab with a drifting clock would otherwise corrupt
-- the ordering of the whole series.
--
-- INTEGER PRIMARY KEY makes ts the rowid, so the table is physically ordered by
-- time. Both queries this page runs — "newest row" and "everything since T" —
-- are then range scans, and the retention delete is a prefix delete.
CREATE TABLE IF NOT EXISTS heartbeat (
  ts        INTEGER PRIMARY KEY,  -- unix seconds, server-assigned
  uptime    INTEGER NOT NULL,     -- seconds since boot
  load1     REAL    NOT NULL,
  load5     REAL,
  load15    REAL,
  cpus      INTEGER,              -- core count, to normalise load into a percentage
  mem_used  INTEGER NOT NULL,     -- bytes
  mem_total INTEGER NOT NULL,     -- bytes
  temp      REAL                  -- CPU °C, null when the box exposes no sensor
);

-- Claude Code token usage, one row per (calendar day, model).
--
-- This table is the archive, not a mirror. The agent re-derives its numbers
-- from the transcripts still on disk, and Claude Code prunes those eventually
-- — so a day that has fallen off the local disk must not fall off the page.
-- Every push is an upsert of the days it can currently see, and nothing is
-- ever deleted. The first push backfills whatever history exists; later ones
-- correct today's row and leave the rest alone.
--
-- `day` is the agent's local calendar day, unlike `heartbeat.ts`, which the
-- Function assigns. That's deliberate: "how much did I spend on Tuesday" means
-- Tuesday where the person was sitting, and re-bucketing a wall-clock day in
-- UTC on the edge would shift every late-evening session into the next day.
CREATE TABLE IF NOT EXISTS token_daily (
  day            TEXT    NOT NULL,          -- 'YYYY-MM-DD', agent-local
  model          TEXT    NOT NULL,
  input          INTEGER NOT NULL DEFAULT 0,
  output         INTEGER NOT NULL DEFAULT 0,
  -- Cache writes are split by TTL because they are priced differently: 1.25x
  -- the input rate for the 5-minute cache, 2x for the 1-hour one. Claude Code
  -- uses 1h entries, so folding them together would understate the notional
  -- cost by a lot on a cache-heavy workload.
  cache_write_5m INTEGER NOT NULL DEFAULT 0,
  cache_write_1h INTEGER NOT NULL DEFAULT 0,
  cache_read     INTEGER NOT NULL DEFAULT 0,
  messages       INTEGER NOT NULL DEFAULT 0, -- billed API responses, deduplicated
  PRIMARY KEY (day, model)
) WITHOUT ROWID;

-- Per-day counts that aren't per-model: how many distinct sessions ran, and
-- how many distinct projects they touched. Project *names* are deliberately
-- absent — they're directory names of private repos, and a count is the part
-- that's interesting anyway.
CREATE TABLE IF NOT EXISTS token_day (
  day      TEXT PRIMARY KEY,
  sessions INTEGER NOT NULL DEFAULT 0,
  projects INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
