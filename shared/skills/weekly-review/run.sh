#!/usr/bin/env bash
# weekly-review — an agent's weekly self-review. Run from the agent's identity dir.
# Invokes claude --print with the canonical prompt; the agent reviews its project
# and may submit at most one high-value idea to the kanban.
set -e
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

AGENT_DIR="$(pwd)"
AGENT_SLUG="${AGENT_SLUG_OVERRIDE:-$(basename "$AGENT_DIR")}"
TS="$(date +%Y-%m-%d-%H%M)"
MODEL=$(agentv_agent_model "$AGENT_SLUG")

[ -f "$AGENT_DIR/CLAUDE.md" ] || { echo "ERR: not in an agent dir (no CLAUDE.md)" >&2; exit 1; }
[ -f "$AGENT_DIR/.api-token" ] || { echo "ERR: no .api-token in $AGENT_DIR" >&2; exit 1; }

PROMPT="You are running your weekly self-review. Read CLAUDE.md, SOUL.md, PROJECT-MAP.md and MEMORY.md in your current directory for context.

Procedure:
1. Read recent commits in your project(s) (paths in PROJECT-MAP.md)
2. Check pm2 status of the project's processes
3. Read the last 200 lines of each project pm2 err.log
4. Read existing ideas for your project: curl -sS -H \"Authorization: Bearer \$(cat .api-token)\" $CONTROL_PLANE_API/v1/ideas?agent=${AGENT_SLUG}
5. Identify 5 candidate improvements internally.
6. Self-score each: impact 1-10, effort 1-10.
7. Discard any where impact < 7 OR impact < 2 × effort.
8. If anything remains, call .claude/skills/shared/submit-idea/submit.sh with the HIGHEST scorer.
9. If nothing remains, output 'NO_IDEA_THIS_WEEK' and explain briefly.
10. Always end with a one-paragraph summary of what you reviewed.

Do NOT invent ideas to fill a quota. A blank week is healthy.

Begin."

echo "[$TS] weekly-review agent=$AGENT_SLUG model=$MODEL"
EXIT=0
claude --print "$PROMPT" \
  --model "$MODEL" \
  --allowedTools "Bash,Read,Write,Grep,Glob" \
  --permission-mode auto \
  --no-session-persistence \
  --max-budget-usd 1.50 2>&1 || EXIT=$?
echo "[$TS] weekly-review exit=$EXIT"
exit $EXIT
