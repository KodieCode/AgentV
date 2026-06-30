#!/usr/bin/env bash
# auto-pr-review — review every open PR across the fleet's repos by dispatching
# /code-review --comment to the MANAGING AGENT's session (the agent who keeps the
# repo reviews it, with project context). Lesson learned the hard way: route by
# owning agent, never by project name — a project's session is named after the
# agent, not the repo.
#
# Owner resolution per repo (first hit):
#   1. shared/skills/auto-pr-review/owners.conf   "repo-basename<TAB>tmux_session"
#   2. $PR_REVIEW_DEFAULT_SESSION  (fleet-manager session — reviews anything)
# De-dupes by head_sha (ledger). Exit 0 always — per-PR failures are logged.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

: "${PROJECTS_DIR:=$HOME/Projects}"
: "${PR_REVIEW_DEFAULT_SESSION:=fleet-manager}"
LEDGER="$SHARED_DIR/skills/auto-pr-review/ledger.jsonl"
OWNERS="$(dirname "${BASH_SOURCE[0]}")/owners.conf"
mkdir -p "$(dirname "$LEDGER")"; touch "$LEDGER"
TS="$(date -u -Iseconds)"

owner_session() {
  local repo="$1" s=""
  [ -f "$OWNERS" ] && s=$(awk -v r="$repo" '!/^#/ && $1==r {print $2}' "$OWNERS")
  echo "${s:-$PR_REVIEW_DEFAULT_SESSION}"
}

reviewed=0; skipped=0; errored=0
for d in "$PROJECTS_DIR"/*/; do
  [ -d "$d/.git" ] || continue
  [ -f "$d/.no-auto-review" ] && continue
  remote="$(git -C "$d" config --get remote.origin.url 2>/dev/null || true)"
  case "$remote" in git@github.com:*|https://github.com/*) ;; *) continue ;; esac
  slug="$(basename "$d")"
  gh_slug="$(echo "$remote" | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\.git$##')"

  prs="$(gh -R "$gh_slug" pr list --state open --json number,headRefOid,author,isDraft \
    --jq '.[] | select(.isDraft==false) | "\(.number)|\(.headRefOid)|\(.author.login)"' 2>/dev/null || true)"
  [ -z "$prs" ] && continue

  while IFS='|' read -r pr head_sha author; do
    [ -z "$pr" ] && continue
    case "$author" in dependabot*|renovate*|github-actions*) continue ;; esac
    if grep -q "\"repo\":\"$gh_slug\",\"pr\":$pr,\"head_sha\":\"$head_sha\"" "$LEDGER" 2>/dev/null; then
      skipped=$((skipped+1)); continue
    fi
    session="$(owner_session "$slug")"
    if ! tmux has-session -t "$session" 2>/dev/null; then
      echo "{\"ts\":\"$TS\",\"repo\":\"$gh_slug\",\"pr\":$pr,\"head_sha\":\"$head_sha\",\"outcome\":\"errored:no_session:$session\"}" >> "$LEDGER"
      errored=$((errored+1)); continue
    fi
    tmux send-keys -t "$session" "/code-review high --comment --pr $pr" Enter
    sleep 1; tmux send-keys -t "$session" Enter
    deadline=$(( $(date +%s) + 300 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
      sleep 10
      tmux capture-pane -p -t "$session" -S -20 2>/dev/null | grep -qE 'posted [0-9]+ comments|no findings|Error|/code-review unknown' && break
    done
    echo "{\"ts\":\"$TS\",\"repo\":\"$gh_slug\",\"pr\":$pr,\"head_sha\":\"$head_sha\",\"outcome\":\"reviewed\"}" >> "$LEDGER"
    reviewed=$((reviewed+1))
  done <<< "$prs"
done

echo "auto-pr-review: reviewed=$reviewed skipped=$skipped errored=$errored"
exit 0
