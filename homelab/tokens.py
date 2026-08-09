#!/usr/bin/env python3
"""Archive local LLM CLI token usage, and roll it up for /api/tokens.

Two jobs, in order:

1. Ingest. Every API response found in the local session logs becomes one row
   in a SQLite database, keyed on the response's own id. Re-ingesting is a
   no-op, so this is safe to run as often as you like.
2. Roll up. The rollup is computed *from that database*, never from the logs
   directly, and printed on stdout for homelab/agent.sh to POST.

The database is the point. LLM CLIs prune their transcripts after a few
weeks, so anything derived only from what's currently on disk is a number that
quietly loses its own history — and an aggregation bug found later can no
longer be corrected, because the evidence is gone. Keeping one row per
response means the totals stay re-derivable long after the logs that produced
them have been deleted.

Python rather than Node because the systemd unit hides $HOME (see
homelab/homelab-status.service) and nvm keeps node inside it. /usr/bin/python3
is always there, and sqlite3 is in the standard library.

Install: see homelab/README.md
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# How many trailing days a routine push covers. Only recent days can still
# change, and every push rewrites the rows it sends — so pushing the whole
# archive every ten minutes would grow linearly with age and eventually
# outgrow D1's free write allowance. The periodic full push below is what
# keeps the remote copy honest despite the narrow window.
DEFAULT_WINDOW_DAYS = 7

# Ceiling for a --full push, so even that can't send something absurd.
MAX_DAYS = 400

# How often to push everything rather than the trailing window. This is the
# repair path: if the agent was offline for longer than the window, or a row
# was corrected in SQLite after the fact, a daily full push reconciles the
# remote copy without anyone noticing something drifted.
FULL_PUSH_INTERVAL = 24 * 60 * 60

# Locally generated messages (interrupts, tool errors) are recorded with this
# model name and no API call behind them. They are not usage.
SYNTHETIC = "<synthetic>"

SCHEMA = """
CREATE TABLE IF NOT EXISTS message (
  id         TEXT    NOT NULL,
  request_id TEXT    NOT NULL DEFAULT '',
  ts         TEXT    NOT NULL,           -- as recorded, UTC
  day        TEXT    NOT NULL,           -- local calendar day
  model      TEXT    NOT NULL,
  project    TEXT    NOT NULL DEFAULT '',
  session    TEXT    NOT NULL DEFAULT '',
  sidechain  INTEGER NOT NULL DEFAULT 0, -- 1 for subagent turns
  input      INTEGER NOT NULL DEFAULT 0,
  output     INTEGER NOT NULL DEFAULT 0,
  cw5m       INTEGER NOT NULL DEFAULT 0,
  cw1h       INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, request_id)
);
CREATE INDEX IF NOT EXISTS message_day ON message(day);
"""


def claude_transcripts(root: Path):
    """Yield (project_directory_name, path) for every session log.

    Recursive on purpose. A main session sits at `<project>/<uuid>.jsonl`, but
    subagents get their own logs a further two levels down at
    `<project>/<uuid>/subagents/agent-*.jsonl`. Globbing only one level deep
    silently drops every subagent's usage — here that was 38 files and about
    6.6% of all tokens, which is exactly the kind of undercount that looks
    plausible enough to never get noticed.

    The project is therefore the first path component below the root, not the
    parent directory, which for a subagent is `subagents`.
    """
    for path in sorted(root.glob("**/*.jsonl")):
        parts = path.relative_to(root).parts
        if len(parts) < 2:
            continue  # a stray file directly under the root, not a session log
        yield parts[0], path


def local_day(stamp: str) -> str:
    """Map a log's UTC timestamp onto the local calendar day.

    Bucketing on the raw string would put an evening session in Beijing on the
    following day, which is not the day the person worked.
    """
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone().strftime("%Y-%m-%d")


def cache_writes(usage: dict) -> tuple:
    """Split cache-creation tokens into (5-minute, 1-hour) buckets.

    The two TTLs bill differently — 1.25x the input rate against 2x — so they
    can't be added together. `cache_creation` carries the split; entries that
    only have the total get it attributed to the 5-minute bucket, which is the
    API default. Any shortfall goes the same way, so the buckets always sum to
    what was actually billed.
    """
    total = usage.get("cache_creation_input_tokens", 0) or 0
    detail = usage.get("cache_creation") or {}
    one_hour = detail.get("ephemeral_1h_input_tokens", 0) or 0
    five_min = detail.get("ephemeral_5m_input_tokens", 0) or 0
    five_min += max(0, total - one_hour - five_min)
    return five_min, one_hour


def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    # WAL so a long ingest doesn't block a concurrent read, and so an
    # interrupted run can't leave a half-written database behind.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def ingest_claude(conn: sqlite3.Connection, root: Path) -> dict:
    """Insert every Claude response found on disk that isn't already recorded."""
    rows = []
    skipped = 0

    for project, path in claude_transcripts(root):
        try:
            handle = path.open(encoding="utf-8", errors="replace")
        except OSError:
            continue

        with handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    # A log being appended to right now can end in a
                    # half-written line. Skipping it is correct; the next run
                    # picks the response up once it is complete.
                    skipped += 1
                    continue

                if row.get("type") != "assistant":
                    continue
                message = row.get("message") or {}
                usage = message.get("usage")
                if not usage:
                    continue

                model = message.get("model")
                if not model or model == SYNTHETIC:
                    continue

                identifier = message.get("id")
                stamp = row.get("timestamp")
                if not identifier or not stamp:
                    continue
                try:
                    day = local_day(stamp)
                except ValueError:
                    continue

                five_min, one_hour = cache_writes(usage)
                rows.append((
                    identifier,
                    row.get("requestId") or "",
                    stamp,
                    day,
                    model,
                    project,
                    row.get("sessionId") or "",
                    1 if row.get("isSidechain") else 0,
                    usage.get("input_tokens", 0) or 0,
                    usage.get("output_tokens", 0) or 0,
                    five_min,
                    one_hour,
                    usage.get("cache_read_input_tokens", 0) or 0,
                ))

    before = conn.execute("SELECT COUNT(*) FROM message").fetchone()[0]
    # INSERT OR IGNORE against the (id, request_id) primary key is the whole
    # deduplication strategy, and it holds across runs rather than only within
    # one. It has to: the CLI rewrites a response's line as a turn develops, so
    # the same response appears three or four times in a single log, and
    # resuming a session copies earlier turns into the new file. Counting the
    # raw lines roughly doubles every number.
    conn.executemany(
        "INSERT OR IGNORE INTO message"
        " (id, request_id, ts, day, model, project, session, sidechain,"
        "  input, output, cw5m, cw1h, cache_read)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.commit()
    after = conn.execute("SELECT COUNT(*) FROM message").fetchone()[0]

    return {"scanned": len(rows), "inserted": after - before, "skipped": skipped, "total": after}


def codex_transcripts(root: Path):
    """Yield every Codex rollout log below its date-based session tree."""
    yield from sorted(root.glob("**/*.jsonl"))


def codex_response_id(session: str, total: dict) -> str:
    """Build a stable id from Codex's session-cumulative token counter."""
    material = json.dumps(total, separators=(",", ":"), sort_keys=True)
    digest = hashlib.sha256(f"{session}\0{material}".encode()).hexdigest()
    return f"codex:{digest}"


def ingest_codex(conn: sqlite3.Connection, root: Path) -> dict:
    """Insert every Codex response found on disk that isn't already recorded."""
    rows = []
    skipped = 0

    for path in codex_transcripts(root):
        session = ""
        project = ""
        model = ""
        sidechain = 0
        try:
            handle = path.open(encoding="utf-8", errors="replace")
        except OSError:
            continue

        with handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except ValueError:
                    skipped += 1
                    continue

                payload = row.get("payload") or {}
                if row.get("type") == "session_meta":
                    session = payload.get("id") or payload.get("session_id") or session
                    project = payload.get("cwd") or project
                    sidechain = 1 if payload.get("parent_thread_id") else 0
                    continue
                if row.get("type") == "turn_context":
                    model = payload.get("model") or model
                    project = payload.get("cwd") or project
                    continue
                if row.get("type") != "event_msg" or payload.get("type") != "token_count":
                    continue

                info = payload.get("info") or {}
                usage = info.get("last_token_usage") or {}
                total = info.get("total_token_usage") or {}
                stamp = row.get("timestamp")
                if not session or not model or not stamp or not usage or not total:
                    continue
                try:
                    day = local_day(stamp)
                except ValueError:
                    continue

                # Codex input_tokens includes cached_input_tokens. Split it
                # into disjoint buckets so the rollup counts each token once.
                # reasoning_output_tokens is already part of output_tokens.
                cached = int(usage.get("cached_input_tokens", 0) or 0)
                input_tokens = int(usage.get("input_tokens", 0) or 0)
                rows.append((
                    codex_response_id(session, total),
                    "",
                    stamp,
                    day,
                    model,
                    project,
                    f"codex:{session}",
                    sidechain,
                    max(0, input_tokens - cached),
                    int(usage.get("output_tokens", 0) or 0),
                    int(usage.get("cache_write_input_tokens", 0) or 0),
                    0,
                    cached,
                ))

    before = conn.execute("SELECT COUNT(*) FROM message").fetchone()[0]
    conn.executemany(
        "INSERT OR IGNORE INTO message"
        " (id, request_id, ts, day, model, project, session, sidechain,"
        "  input, output, cw5m, cw1h, cache_read)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.commit()
    after = conn.execute("SELECT COUNT(*) FROM message").fetchone()[0]
    return {"scanned": len(rows), "inserted": after - before, "skipped": skipped, "total": after}


def rollup(conn: sqlite3.Connection, window: int) -> dict:
    """Aggregate the archive into the wire format the endpoint expects."""
    days = [r[0] for r in conn.execute("SELECT DISTINCT day FROM message ORDER BY day")]
    days = days[-min(window, MAX_DAYS):]
    if not days:
        return {"generatedAt": int(time.time()), "days": [], "meta": []}

    placeholders = ",".join("?" * len(days))

    rows = conn.execute(
        f"""SELECT day, model, SUM(input), SUM(output), SUM(cw5m), SUM(cw1h),
                   SUM(cache_read), COUNT(*)
              FROM message
             WHERE day IN ({placeholders})
             GROUP BY day, model
             ORDER BY day, model""",
        days,
    ).fetchall()

    meta = conn.execute(
        f"""SELECT day, COUNT(DISTINCT session), COUNT(DISTINCT project)
              FROM message
             WHERE day IN ({placeholders})
             GROUP BY day
             ORDER BY day""",
        days,
    ).fetchall()

    # Positional rows rather than objects: this is a wire format read by
    # exactly one endpoint, and the key names would be most of the payload.
    return {
        "generatedAt": int(time.time()),
        "days": [list(r) for r in rows],
        "meta": [list(r) for r in meta],
    }


def digest_of(payload: dict) -> str:
    """Fingerprint the numbers, deliberately excluding `generatedAt`."""
    material = json.dumps(
        {"days": payload["days"], "meta": payload["meta"]},
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(material.encode()).hexdigest()


def read_state(state_file: Path) -> dict:
    try:
        return json.loads(state_file.read_text())
    except (OSError, ValueError):
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, help="path to the SQLite archive")
    parser.add_argument(
        "--state-file",
        type=Path,
        help="remember the last rollup here and stay quiet when nothing changed",
    )
    parser.add_argument(
        "--min-interval",
        type=int,
        default=600,
        help="seconds before an unchanged rollup is re-sent anyway (default: 600)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_WINDOW_DAYS,
        help=f"how many trailing days to send (default: {DEFAULT_WINDOW_DAYS})",
    )
    parser.add_argument(
        "--full", action="store_true", help="send the whole archive, not just recent days"
    )
    parser.add_argument(
        "--stats", action="store_true", help="report the archive on stderr and send nothing"
    )
    args = parser.parse_args()

    db_path = args.db or Path(
        os.environ.get("STATE_DIRECTORY") or Path.home() / ".local/state/homelab-status"
    ) / "tokens.db"
    conn = open_db(db_path)

    claude_root = Path(
        os.environ.get("CLAUDE_PROJECTS_DIR") or Path.home() / ".claude" / "projects"
    )
    codex_root = Path(
        os.environ.get("CODEX_SESSIONS_DIR") or Path.home() / ".codex" / "sessions"
    )
    inserted = 0
    for name, root, collector in (
        ("Claude", claude_root, ingest_claude),
        ("Codex", codex_root, ingest_codex),
    ):
        if root.is_dir():
            result = collector(conn, root)
            inserted += result["inserted"]
            if result["inserted"]:
                print(f"archived {result['inserted']} new {name} responses", file=sys.stderr)

    total = conn.execute("SELECT COUNT(*) FROM message").fetchone()[0]
    if inserted:
        print(f"{total} responses total", file=sys.stderr)
    if not claude_root.is_dir() and not codex_root.is_dir() and not total:
        # No logs to read and nothing archived from an earlier run: there is
        # genuinely nothing to report.
        print("no Claude or Codex session logs and an empty archive", file=sys.stderr)
        return 1

    if args.stats:
        row = conn.execute(
            "SELECT COUNT(*), COUNT(DISTINCT day), MIN(day), MAX(day),"
            " SUM(input+output+cw5m+cw1h+cache_read) FROM message"
        ).fetchone()
        print(
            f"{row[0]:,} responses over {row[1]} days ({row[2]} to {row[3]}), "
            f"{row[4]:,} tokens, archive at {db_path}",
            file=sys.stderr,
        )
        return 0

    state = read_state(args.state_file) if args.state_file else {}
    now = time.time()

    # Push everything when asked, on the first run, or once a day so the
    # remote copy reconciles with the archive even if the trailing window
    # missed something.
    full = (
        args.full
        or not state
        or now - float(state.get("fullPushed", 0)) >= FULL_PUSH_INTERVAL
    )

    # The digest always describes the *window* rollup, never whichever payload
    # happens to be going out. Fingerprinting the payload instead would make
    # every window push look changed just because the previous one was a full
    # push, costing a redundant push after each daily reconcile.
    window = rollup(conn, args.days)
    if not window["days"]:
        print("archive is empty", file=sys.stderr)
        return 1

    if args.state_file:
        digest = digest_of(window)
        unchanged = digest == state.get("digest")
        due = now - float(state.get("pushed", 0)) >= args.min_interval
        if not full and unchanged and not due:
            return 3  # nothing worth sending; agent.sh treats this as success

        try:
            args.state_file.parent.mkdir(parents=True, exist_ok=True)
            args.state_file.write_text(json.dumps({
                "digest": digest,
                "pushed": int(now),
                "fullPushed": int(now) if full else state.get("fullPushed", 0),
            }))
        except OSError as err:
            # Losing the state file costs an unnecessary push, not correctness
            # — the endpoint's upserts are idempotent.
            print(f"could not write {args.state_file}: {err}", file=sys.stderr)

    json.dump(rollup(conn, MAX_DAYS) if full else window, sys.stdout, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
