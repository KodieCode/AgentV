#!/usr/bin/env bash
# install-crons — install the fleet's safety-net cron entries in the user's
# crontab. Without these, the safety nets exist in the repo but NEVER RUN:
# missed --wake flags stay missed, dead sessions go unnoticed, no pane audit
# trail, no automated nightly memory capture.
#
#   */5  inbox-watchdog   wake idle agents with unread inbox entries
#   */10 pane-snapshot    tmux pane audit trail per agent
#   0 3  nightly-wrap-up  daily memory capture for agents that worked today
#   0 *  heartbeat        hourly session liveness log
#   30 6 version-check    nightly "is a newer AgentV available?" (banner + notify)
#
# Idempotent: an entry is only appended when its script path isn't already in
# the crontab (re-runs and hand-edited schedules are left alone).
# Skip entirely with SKIP_CRON_INSTALL=1 (e.g. operators who run the safety
# nets under systemd timers or a central scheduler instead).
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/shared/lib/agentv-env.sh"

if [ "${SKIP_CRON_INSTALL:-0}" = "1" ]; then
  echo "  ⧗ SKIP_CRON_INSTALL=1 — skipping safety-net cron install"
  exit 0
fi

if ! command -v crontab >/dev/null 2>&1; then
  echo "  ! crontab not available — install cron or set the safety nets up under systemd timers" >&2
  exit 0
fi

SK="$SHARED_DIR/skills"
ENTRIES=(
  "*/5 * * * * $SK/inbox-watchdog/watchdog.sh >/dev/null 2>&1"
  "*/10 * * * * $SK/pane-snapshot/snapshot.sh >/dev/null 2>&1"
  "0 3 * * * $SK/nightly-wrap-up/run.sh >/dev/null 2>&1"
  "0 * * * * $SK/heartbeat/heartbeat.sh >/dev/null 2>&1"
  "30 6 * * * $SK/version-check/check.sh >/dev/null 2>&1"
)

current="$(crontab -l 2>/dev/null || true)"
added=0
for entry in "${ENTRIES[@]}"; do
  script="$(printf '%s\n' "$entry" | awk '{print $6}')"   # the script path (field 6) is the idempotence key
  if printf '%s\n' "$current" | grep -Fq "$script"; then
    echo "  ✓ cron present: $script"
  else
    current="${current}${current:+
}$entry"
    added=$((added + 1))
    echo "  + adding cron: $entry"
  fi
done

if [ "$added" -gt 0 ]; then
  printf '%s\n' "$current" | crontab -
  echo "  ✓ installed $added safety-net cron entr$([ "$added" = 1 ] && echo y || echo ies)"
else
  echo "  ✓ all safety-net crons already installed"
fi
