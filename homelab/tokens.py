#!/usr/bin/env python3
"""Roll up Claude Code token usage into a small JSON payload on stdout.

Reads the transcripts Claude Code writes under ~/.claude/projects and prints
one compact object for homelab/agent.sh to POST to /api/tokens. Reads only;
never writes to or prunes the transcripts.

Python rather than Node because the systemd unit hides $HOME from the service
(see homelab/homelab-status.service) and nvm keeps node inside it. /usr/bin/
python3 is always there, and this needs nothing outside the standard library.

Install: see homelab/README.md
"""
import argparse
import hashlib
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# How many trailing days a routine push covers. Only today's row can really
# still change, but a week costs nothing and absorbs a midnight boundary, a
# clock adjustment, or a few days of the agent being down.
#
# This window is what keeps the write cost flat. Every push rewrites every row
# it sends, so pushing the whole history would grow linearly with age: a year
# in, that's ~900 rows a push, and at one push per ten minutes it would blow
# through D1's 100,000 rows/day free limit. Seven days is ~17 rows a push
# forever. The endpoint never deletes, so older days stay archived server-side.
DEFAULT_WINDOW_DAYS = 7

# The ceiling for a --full backfill, so even that can't send something absurd.
MAX_DAYS = 400

# Locally generated messages (interrupts, tool errors) are recorded with this
# model name and no API call behind them. They are not usage.
SYNTHETIC = "<synthetic>"


def transcripts(root: Path):
    """Yield (project_directory_name, path) for every transcript.

    Recursive on purpose. A main session sits at `<project>/<uuid>.jsonl`, but
    subagents get their own transcripts a further two levels down at
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
            continue  # a stray file directly under the root, not a transcript
        yield parts[0], path


def local_day(stamp: str) -> str:
    """Map a transcript's UTC timestamp onto the local calendar day.

    Claude Code writes timestamps in UTC. Bucketing on the raw string would put
    an evening session in Beijing on the following day, which is not the day
    the person worked.
    """
    # fromisoformat handles the trailing 'Z' from 3.11 onwards; the replace
    # keeps this working on older interpreters too.
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone().strftime("%Y-%m-%d")


def cache_writes(usage: dict) -> tuple:
    """Split cache-creation tokens into (5-minute, 1-hour) buckets.

    The two TTLs bill differently (1.25x vs 2x the input rate), so they can't
    be added together. `cache_creation` carries the split; older entries only
    have the total, which is attributed to the 5-minute bucket because that is
    the API default. Any shortfall between the split and the total goes the
    same way, so the buckets always sum to what was actually billed.
    """
    total = usage.get("cache_creation_input_tokens", 0) or 0
    detail = usage.get("cache_creation") or {}
    one_hour = detail.get("ephemeral_1h_input_tokens", 0) or 0
    five_min = detail.get("ephemeral_5m_input_tokens", 0) or 0
    five_min += max(0, total - one_hour - five_min)
    return five_min, one_hour


def collect(root: Path, window: int) -> dict:
    # (message.id, requestId) is the deduplication key. It has to be: Claude
    # Code rewrites a message's line as a turn develops, so a single response
    # appears three or four times in one file, and resuming a session copies
    # earlier turns into the new transcript. Summing the raw lines roughly
    # doubles every number.
    seen = set()

    daily = defaultdict(lambda: defaultdict(int))
    sessions = defaultdict(set)
    projects = defaultdict(set)
    skipped = 0

    for project, path in transcripts(root):
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
                    # A transcript being appended to right now can end in a
                    # half-written line. Skipping it is correct; the next run
                    # picks the message up once it is complete.
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

                key = (message.get("id"), row.get("requestId"))
                if key in seen:
                    continue
                seen.add(key)

                stamp = row.get("timestamp")
                if not stamp:
                    continue
                try:
                    day = local_day(stamp)
                except ValueError:
                    continue

                five_min, one_hour = cache_writes(usage)
                bucket = daily[(day, model)]
                bucket["input"] += usage.get("input_tokens", 0) or 0
                bucket["output"] += usage.get("output_tokens", 0) or 0
                bucket["cache_write_5m"] += five_min
                bucket["cache_write_1h"] += one_hour
                bucket["cache_read"] += usage.get("cache_read_input_tokens", 0) or 0
                bucket["messages"] += 1

                if row.get("sessionId"):
                    sessions[day].add(row["sessionId"])
                projects[day].add(project)

    days = sorted({day for day, _ in daily})[-min(window, MAX_DAYS):]
    keep = set(days)

    # Positional rows rather than objects: this is a wire format read by
    # exactly one endpoint, and the key names would be most of the payload.
    rows = [
        [
            day,
            model,
            b["input"],
            b["output"],
            b["cache_write_5m"],
            b["cache_write_1h"],
            b["cache_read"],
            b["messages"],
        ]
        for (day, model), b in sorted(daily.items())
        if day in keep
    ]

    return {
        "generatedAt": int(time.time()),
        "days": rows,
        "meta": [[day, len(sessions[day]), len(projects[day])] for day in days],
        "skippedLines": skipped,
    }


def digest_of(payload: dict) -> str:
    """Fingerprint the numbers, deliberately excluding `generatedAt`.

    The timestamp changes on every run, so hashing the whole payload would
    report "changed" every minute and defeat the point of checking.
    """
    material = json.dumps(
        {"days": payload["days"], "meta": payload["meta"]},
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(material.encode()).hexdigest()


def should_emit(state_file: Path, digest: str, min_interval: int) -> bool:
    """Decide whether this rollup is worth a request.

    The timer fires every minute for the heartbeat, but these numbers only move
    when I'm actually using Claude Code — and each push rewrites every day row,
    so re-sending an unchanged rollup all day would burn a real share of D1's
    daily write allowance restating yesterday. Push when something changed, or
    when `min_interval` has passed, whichever comes first.

    The periodic push is what makes this self-healing: the state file is
    written when the payload is emitted, not when the POST succeeds, so a
    failed push is retried at the next interval rather than being wedged out
    until the numbers happen to change again.
    """
    try:
        previous = json.loads(state_file.read_text())
    except (OSError, ValueError):
        return True

    if previous.get("digest") != digest:
        return True
    return time.time() - float(previous.get("pushed", 0)) >= min_interval


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
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
        "--full",
        action="store_true",
        help="send the whole history — for the first push, or to re-backfill",
    )
    args = parser.parse_args()

    root = Path(
        os.environ.get("CLAUDE_PROJECTS_DIR")
        or Path.home() / ".claude" / "projects"
    )
    if not root.is_dir():
        print(f"no transcript directory at {root}", file=sys.stderr)
        return 1

    payload = collect(root, MAX_DAYS if args.full else args.days)
    if not payload["days"]:
        print(f"no usage found under {root}", file=sys.stderr)
        return 1

    if args.state_file:
        digest = digest_of(payload)
        if not should_emit(args.state_file, digest, args.min_interval):
            return 3  # nothing worth sending; agent.sh treats this as success

        try:
            args.state_file.parent.mkdir(parents=True, exist_ok=True)
            args.state_file.write_text(
                json.dumps({"digest": digest, "pushed": int(time.time())})
            )
        except OSError as err:
            # Losing the state file costs an unnecessary push, not correctness
            # — the endpoint's upserts are idempotent.
            print(f"could not write {args.state_file}: {err}", file=sys.stderr)

    json.dump(payload, sys.stdout, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
