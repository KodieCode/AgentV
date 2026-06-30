#!/usr/bin/env bash
# daily-digest — fleet-manager's daily status across all projects. Run from the
# fleet-manager's identity dir. Produces a skimmable digest and PERSISTS it to the
# reports table (kind=digest) so the dashboard surfaces it (email optional, separate).
set -e
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

AGENT_DIR="$(pwd)"
AGENT_SLUG="${AGENT_SLUG_OVERRIDE:-$(basename "$AGENT_DIR")}"
TS="$(date +%Y-%m-%d-%H%M)"; DATE="$(date +%Y-%m-%d)"
MODEL=$(agentv_agent_model "$AGENT_SLUG")
[ -f "$AGENT_DIR/CLAUDE.md" ] || { echo "ERR: not in the fleet-manager agent dir (no CLAUDE.md)" >&2; exit 1; }

REPORT_SAVE="$SHARED_DIR/skills/report/save.sh"
PRREVIEW="$SHARED_DIR/skills/auto-pr-review/run.sh"

PROMPT="You are ${AGENT_SLUG}, running the daily digest. Read CLAUDE.md, PROJECT-REGISTRY.md, and MEMORY.md in your current directory, and follow .claude/skills/shared/daily-digest/SKILL.md if present.

Your job:
1. For each live project in PROJECT-REGISTRY.md: git log (last 24h), pm2 health, open PRs on GitHub.
2. For projects on remote hosts: check if prod is behind origin/main (deploy gaps).
3. Read the team activity log (last 24h) at: $TEAM_ACTIVITY — summarise what each agent shipped.
4. If present, run PR auto-review: $PRREVIEW
5. Produce a skimmable digest. Flag attention items with ⚠️. Include a 'Quiet' section. No secrets.
6. Write it to memory/digest-${DATE}.md
7. PERSIST it so the dashboard shows it:
   $REPORT_SAVE digest ${AGENT_SLUG} \"Daily digest ${DATE}\" memory/digest-${DATE}.md
8. (Optional) if an email relay is configured, also email it to the admin.

Keep it tight. Begin."

echo "[$TS] daily-digest agent=$AGENT_SLUG"
claude --print "$PROMPT" \
  --model "$MODEL" \
  --allowedTools "Bash,Read,Write,Grep,Glob" \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --max-budget-usd 3.00 2>&1
echo "[$TS] daily-digest exit=$?"
