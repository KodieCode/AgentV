#!/usr/bin/env bash
# pane-snapshot — capture each live agent's tmux pane to a dated file, so there's
# an audit trail of what each agent was doing (debugging, "what happened at 3am").
# Roster from the DB. Snapshots land in <agent dir>/memory/pane-snapshots/.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

DAY=$(date +%Y-%m-%d)
while IFS=':' read -r slug session dir; do
  [ -n "$slug" ] || continue
  tmux has-session -t "$session" 2>/dev/null || continue
  out="$dir/memory/pane-snapshots"
  mkdir -p "$out"
  tmux capture-pane -t "$session" -p -S -200 2>/dev/null > "$out/$slug-$DAY.txt"
done < <(agentv_agent_roster)
