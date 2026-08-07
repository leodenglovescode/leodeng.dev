#!/usr/bin/env bash
# Pushes a heartbeat to https://leodeng.dev/api/homelab, and a Claude Code
# token rollup to https://leodeng.dev/api/tokens.
#
# Runs on the home server, which is behind Headscale and has no inbound path
# from the internet — so the box reaches out rather than being polled.
#
# The heartbeat reads only /proc and /sys, needs no root, and has no
# dependencies beyond curl and awk. Everything it sends is public the moment it
# lands: uptime, load, memory, CPU temperature. Nothing that identifies the
# machine or what runs on it — see functions/api/homelab.js for why.
#
# The token rollup additionally reads ~/.claude/projects and needs python3.
# It sends per-day token counts and nothing else — see homelab/tokens.py and
# functions/api/tokens.js.
#
# Install: see homelab/README.md
set -euo pipefail

ENDPOINT="${HOMELAB_ENDPOINT:-https://leodeng.dev/api/homelab}"
: "${HOMELAB_TOKEN:?HOMELAB_TOKEN is not set (see homelab/README.md)}"

# Everything the token rollup needs is set up inside push_tokens(), below the
# heartbeat, rather than here. The rollup is the optional half of this script
# and must not be able to stop the half that isn't — and setup at the top of a
# `set -e -u` script runs before the heartbeat, so a single unset variable
# there takes the whole run down. That is not hypothetical: an unguarded $HOME
# in this block failed a heartbeat under DynamicUser=yes, which sets no HOME.

# --- uptime ------------------------------------------------------------------
read -r uptime_raw _ < /proc/uptime
uptime=${uptime_raw%%.*}

# --- load --------------------------------------------------------------------
read -r load1 load5 load15 _ < /proc/loadavg

cpus=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo)

# --- memory ------------------------------------------------------------------
# MemAvailable, not MemFree: free memory excludes reclaimable page cache, so on
# any box that has been up a while it reports ~100% used and the chart is a
# flat line at the top.
mem_total_kb=$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo)
mem_avail_kb=$(awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo)
mem_total=$(( mem_total_kb * 1024 ))
mem_used=$(( (mem_total_kb - mem_avail_kb) * 1024 ))

# --- CPU temperature ---------------------------------------------------------
# thermal_zone0 is whatever the firmware listed first, which on a desktop board
# is often the chipset or an ACPI stub rather than the CPU. Prefer a hwmon
# device that names itself, and fall back to the thermal zone only if none of
# them do.
temp=null
for hwmon in /sys/class/hwmon/hwmon*; do
  [ -r "$hwmon/name" ] || continue
  case "$(cat "$hwmon/name")" in
    coretemp|k10temp|zenpower|cpu_thermal|soc_thermal|nct*|it87*)
      if [ -r "$hwmon/temp1_input" ]; then
        temp=$(awk '{printf "%.1f", $1/1000; exit}' "$hwmon/temp1_input")
        break
      fi
      ;;
  esac
done
if [ "$temp" = null ] && [ -r /sys/class/thermal/thermal_zone0/temp ]; then
  temp=$(awk '{printf "%.1f", $1/1000; exit}' /sys/class/thermal/thermal_zone0/temp)
fi

# --- push --------------------------------------------------------------------
payload=$(printf '{"uptime":%s,"load1":%s,"load5":%s,"load15":%s,"cpus":%s,"memUsed":%s,"memTotal":%s,"temp":%s}' \
  "$uptime" "$load1" "$load5" "$load15" "$cpus" "$mem_used" "$mem_total" "$temp")

# --fail so a 4xx/5xx becomes a non-zero exit and shows up in the timer's
# journal, rather than silently succeeding with an error body.
curl --silent --show-error --fail \
     --max-time 10 --retry 2 --retry-delay 3 \
     -X POST "$ENDPOINT" \
     -H 'content-type: application/json' \
     -H "authorization: Bearer ${HOMELAB_TOKEN}" \
     -d "$payload" \
     -o /dev/null

# --- Claude Code token usage -------------------------------------------------
# Deliberately never fails the unit. The heartbeat is the job this timer exists
# for, and a box with no Claude Code transcripts on it — or no python3 — is a
# perfectly healthy box. Problems go to the journal and the run still exits 0.
push_tokens() {
  local endpoint script min_interval state_dir
  endpoint="${HOMELAB_TOKENS_ENDPOINT:-https://leodeng.dev/api/tokens}"
  script="${HOMELAB_TOKENS_SCRIPT:-/usr/local/bin/homelab-tokens.py}"

  # How long an unchanged rollup may go un-resent. See tokens.py.
  min_interval="${HOMELAB_TOKENS_MIN_INTERVAL:-600}"

  # systemd sets STATE_DIRECTORY from StateDirectory= in the unit; the rest of
  # the chain is for running this by hand. Every link tolerates being unset,
  # HOME included — under `set -u` a bare $HOME is a fatal error, not an empty
  # string.
  state_dir="${STATE_DIRECTORY:-${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/homelab-status}"

  if [ ! -r "$script" ]; then
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not found; skipping the token rollup" >&2
    return 0
  fi

  local state="$state_dir/tokens.json"

  # No state file means this box has never pushed, so send the whole history
  # once to backfill. Every run after that sends only the trailing few days —
  # older rows can't change, and re-sending them forever is what would
  # eventually outgrow D1's free write allowance. See tokens.py.
  local scope=()
  [ -f "$state" ] || scope=(--full)

  # tokens.py exits 3 to mean "nothing worth sending", which is the common case
  # on an idle box — so the exit status is inspected rather than trusted, and
  # `set -e` is held off for exactly this call.
  local payload status
  set +e
  payload=$(python3 "$script" \
    --state-file "$state" \
    --min-interval "$min_interval" \
    "${scope[@]}")
  status=$?
  set -e

  case "$status" in
    0) ;;
    3) return 0 ;;
    *) echo "token rollup failed (exit $status); heartbeat was still sent" >&2; return 0 ;;
  esac

  [ -n "$payload" ] || return 0

  if ! curl --silent --show-error --fail \
            --max-time 20 --retry 2 --retry-delay 3 \
            -X POST "$endpoint" \
            -H 'content-type: application/json' \
            -H "authorization: Bearer ${HOMELAB_TOKEN}" \
            -d "$payload" \
            -o /dev/null; then
    # The state file was already stamped, so this rollup won't be retried until
    # min_interval is up. That bounds the damage at one stale interval instead
    # of hammering a failing endpoint every minute.
    echo "token push failed; will retry within ${min_interval}s" >&2
  fi
}

push_tokens
