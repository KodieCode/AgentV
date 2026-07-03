#!/usr/bin/env bash
# team-review — periodic (≈monthly) review of the agent roster + workload.
# Run from the fleet-manager's dir. Conservative: proposes changes as kanban ideas
# (never auto-creates/retires agents). Persists the review to the reports table.
set -e
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

AGENT_DIR="$(pwd)"
AGENT_SLUG="${AGENT_SLUG_OVERRIDE:-$(basename "$AGENT_DIR")}"
TS="$(date +%Y-%m-%d-%H%M)"; DATE="$(date +%Y-%m-%d)"
MODEL=$(agentv_agent_model "$AGENT_SLUG")
[ -f "$AGENT_DIR/CLAUDE.md" ] || { echo "ERR: not in the fleet-manager dir" >&2; exit 1; }
REPORT_SAVE="$SHARED_DIR/skills/report/save.sh"

PROMPT="You are ${AGENT_SLUG} running the periodic team review. Read CLAUDE.md + the team roster (TEAM.md) for context.

Procedure:
1. Read TEAM.md — current roster + roles.
2. Read the team activity log (last 30 days) at: $TEAM_ACTIVITY — what each agent did + handoffs.
3. For each agent: getting work? overloaded? role still distinct, or bleeding into another's?
4. Look for repeating work NOT covered by an agent (candidate new seat), or two agents half-pulled into the same task (candidate split).
5. Conservatively propose changes — ONE kanban idea per concrete change, via:
   .claude/skills/shared/submit-idea/submit.sh ${AGENT_SLUG} \"<title>\" <impact> <effort> \"<body>\"
   Default is NO change. New/retired agents need operator sign-off — propose, never act.
6. Write the review to memory/team-review-${DATE}.md, then persist it:
   $REPORT_SAVE team_review ${AGENT_SLUG} \"Team review ${DATE}\" memory/team-review-${DATE}.md

Begin."

echo "[$TS] team-review agent=$AGENT_SLUG"
EXIT=0
claude --print "$PROMPT" --model "$MODEL" \
  --allowedTools "Bash,Read,Write,Grep,Glob" \
  --permission-mode auto --no-session-persistence --max-budget-usd 2.00 2>&1 || EXIT=$?
echo "[$TS] team-review exit=$EXIT"
exit $EXIT
