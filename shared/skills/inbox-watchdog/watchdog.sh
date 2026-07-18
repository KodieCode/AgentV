#!/usr/bin/env bash
# inbox-watchdog — every 5 min, wake any agent with UNREAD inbox entries whose
# session is idle. Safety net for missed --wake flags. Roster comes from the DB
# (agentv_agent_roster) — no hardcoded agent list.
#
# Polite waiter: skips busy ("esc to interrupt"), skips user-composing, skips
# empty inboxes (content guard — stops archive-truncate false wakes).
# Marker (<inbox>.watchdog-marker) records the last wake; re-wakes only when the
# inbox is newer than the marker AND has content.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

LOG="$SHARED_DIR/skills/inbox-watchdog/logs/watchdog.log"
mkdir -p "$(dirname "$LOG")"
NOTIFY="$SHARED_DIR/skills/notify/notify.sh"
NOW=$(date -u -Iseconds)
echo "[$NOW] watchdog tick" >> "$LOG"

while IFS=':' read -r slug session dir; do
  [ -n "$slug" ] || continue
  inbox="$dir/notifications/inbox.jsonl"
  [ -f "$inbox" ] || { echo "  $slug: no inbox" >> "$LOG"; continue; }

  # Empty inbox — nothing to wake about, even if mtime bumped (archive-truncate).
  grep -q '[^[:space:]]' "$inbox" 2>/dev/null || continue

  marker="${inbox%.jsonl}.watchdog-marker"
  inbox_mtime=$(stat -c %Y "$inbox" 2>/dev/null || echo 0)
  marker_mtime=$([ -f "$marker" ] && stat -c %Y "$marker" || echo 0)
  [ "$inbox_mtime" -le "$marker_mtime" ] && continue

  tmux has-session -t "$session" 2>/dev/null || { echo "  $slug: session '$session' down" >> "$LOG"; continue; }

  pane=$(tmux capture-pane -t "$session" -p 2>/dev/null | tail -10)
  if echo "$pane" | grep -q "esc to interrupt"; then echo "  $slug: busy, skip" >> "$LOG"; continue; fi
  if echo "$pane" | grep -qE "❯ [^ ]"; then echo "  $slug: composing, skip" >> "$LOG"; continue; fi

  wake_msg="New entry in your inbox — read notifications/inbox.jsonl and action it."
  # opencode's TUI submits on a single Enter; the Claude double-Enter garbles it.
  if [ -f "$(dirname "$(dirname "$inbox")")/opencode.jsonc" ]; then
    tmux send-keys -t "$session" "$wake_msg" Enter
  else
    tmux send-keys -t "$session" "$wake_msg" Enter
    sleep 1
    tmux send-keys -t "$session" Enter
  fi
  touch "$marker"
  echo "  $slug: WOKE" >> "$LOG"
done < <(agentv_agent_roster)
