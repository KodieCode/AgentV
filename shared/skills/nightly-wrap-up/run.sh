#!/usr/bin/env bash
# nightly-wrap-up — ~03:00 daily. Wrap up agents that did work TODAY
# (activity-gated), skipping busy sessions (polite-waiter). Automated daily
# memory capture so wrap-up isn't forgotten. Idle agents are skipped (no empty
# notes, no wasted token spend). Roster from the DB.
#
# Activity gate (OR): agent has a team_activity entry "from": "<slug>" today,
#   OR a meaningful file in its dir changed today (excludes inbox/markers/logs/snapshots).
# Usage: run.sh [--dry-run]
set -u
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

LOG="$SHARED_DIR/skills/nightly-wrap-up/logs/nightly-wrap-up.log"
mkdir -p "$(dirname "$LOG")"
NOTIFY="$SHARED_DIR/skills/notify/notify.sh"
# Runs at 03:00, so the work being wrapped is the day that just ended (yesterday)
# plus any early-hours work today. Gate on the window since yesterday 00:00.
TODAY=$(date +%Y-%m-%d)
YESTERDAY=$(date -d 'yesterday' +%Y-%m-%d)
NOW=$(date -u -Iseconds)
MSG="Nightly automated wrap-up (03:00). You had activity yesterday — save your daily note + promote any durable rules to memory per your wrap-up skill. No reply needed unless you're blocked."

echo "[$NOW] nightly-wrap-up tick (dry=$DRY)" >> "$LOG"
woke=0; idle=0; busy=0
while IFS=':' read -r slug session dir; do
  [ -n "$slug" ] || continue
  tmux has-session -t "$session" 2>/dev/null || continue

  active=0
  if [ -f "$TEAM_ACTIVITY" ] && grep -hE "$YESTERDAY|$TODAY" "$TEAM_ACTIVITY" 2>/dev/null | grep -q "\"from\": \"$slug\""; then
    active=1
  fi
  if [ "$active" -eq 0 ] && [ -d "$dir" ]; then
    if find "$dir" -type f -newermt "$YESTERDAY 00:00:00" \
         -not -path '*/node_modules/*' -not -path '*/.git/*' \
         -not -path '*/notifications/*' -not -path '*/pane-snapshots/*' \
         -not -name '*marker*' -not -name '*.log' 2>/dev/null | grep -q .; then
      active=1
    fi
  fi
  [ "$active" -eq 0 ] && { echo "  $slug: idle, skip" >> "$LOG"; idle=$((idle+1)); continue; }

  pane=$(tmux capture-pane -t "$session" -p 2>/dev/null | tail -10)
  if echo "$pane" | grep -q "esc to interrupt"; then echo "  $slug: busy" >> "$LOG"; busy=$((busy+1)); continue; fi
  if echo "$pane" | grep -qE "❯ [^ ]"; then echo "  $slug: composing" >> "$LOG"; busy=$((busy+1)); continue; fi

  if [ "$DRY" -eq 1 ]; then echo "WOULD wrap: $slug"; woke=$((woke+1)); continue; fi
  "$NOTIFY" --to "$slug" --from fleet-manager --wake "$MSG" >/dev/null 2>&1 && { echo "  $slug: WRAPPED" >> "$LOG"; woke=$((woke+1)); }
done < <(agentv_agent_roster)

echo "[$NOW] done: wrapped=$woke idle=$idle busy=$busy" >> "$LOG"
echo "nightly-wrap-up: wrapped=$woke idle=$idle busy=$busy"
