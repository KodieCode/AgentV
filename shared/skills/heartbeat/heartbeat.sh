#!/usr/bin/env bash
# heartbeat — hourly liveness check across the fleet. Logs each agent's session
# state (alive/dead). A dead expected session is a signal for the fleet-manager
# to revive it. Roster from the DB — no hardcoded list.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

LOG="$SHARED_DIR/skills/heartbeat/logs/heartbeat.log"
mkdir -p "$(dirname "$LOG")"
NOW=$(date -u -Iseconds)

alive=0; dead=0
while IFS=':' read -r slug session dir; do
  [ -n "$slug" ] || continue
  if tmux has-session -t "$session" 2>/dev/null; then
    alive=$((alive+1))
  else
    dead=$((dead+1))
    echo "[$NOW] DEAD: $slug (session '$session')" >> "$LOG"
  fi
done < <(agentv_agent_roster)

echo "[$NOW] heartbeat: alive=$alive dead=$dead" >> "$LOG"
