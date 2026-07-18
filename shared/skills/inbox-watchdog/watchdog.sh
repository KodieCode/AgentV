#!/usr/bin/env bash
# inbox-watchdog — every 5 min, wake any agent with UNREAD inbox entries whose
# session is idle. Safety net for missed --wake flags. Roster comes from the DB
# (agentv_agent_roster) — no hardcoded agent list.
#
# Polite waiter: skips busy ("esc to interrupt"), skips user-composing, skips
# empty inboxes (content guard — stops archive-truncate false wakes).
# Marker (<inbox>.watchdog-marker) stores a hash of the inbox content last woken
# on; re-wakes only when the inbox content actually changes (not on mtime).
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
  # Re-wake guard by CONTENT, not mtime. inbox mtime gets bumped by things other
  # than new messages (in-place rewrites, fs ops, archive-truncate), and every
  # bump beat the marker → the watchdog re-fired on an already-woken, UNCHANGED
  # inbox, repeat-waking idle agents. The marker stores a hash of the inbox
  # content we last woke on; re-wake only when that content changes.
  inbox_hash=$(md5sum "$inbox" 2>/dev/null | cut -d' ' -f1)
  marker_hash=$([ -f "$marker" ] && cat "$marker" 2>/dev/null || echo "")
  [ -n "$inbox_hash" ] && [ "$inbox_hash" = "$marker_hash" ] && continue

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
  # Claim the marker with the CONTENT we just woke on (not a bare touch) so a
  # later mtime bump with identical content doesn't re-fire.
  printf '%s\n' "$inbox_hash" > "$marker"
  echo "  $slug: WOKE" >> "$LOG"
done < <(agentv_agent_roster)
