-- D1 schema for the /homelab status page.
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
