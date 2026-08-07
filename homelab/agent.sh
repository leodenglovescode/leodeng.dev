#!/usr/bin/env bash
# Pushes a heartbeat to https://leodeng.dev/api/homelab.
#
# Runs on the home server, which is behind Headscale and has no inbound path
# from the internet — so the box reaches out rather than being polled.
#
# Reads only /proc and /sys, needs no root, and has no dependencies beyond
# curl and awk. Everything it sends is public the moment it lands: uptime,
# load, memory, CPU temperature. Nothing that identifies the machine or what
# runs on it — see functions/api/homelab.js for why.
#
# Install: see homelab/README.md
set -euo pipefail

ENDPOINT="${HOMELAB_ENDPOINT:-https://leodeng.dev/api/homelab}"
: "${HOMELAB_TOKEN:?HOMELAB_TOKEN is not set (see homelab/README.md)}"

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
