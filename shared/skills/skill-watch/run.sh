#!/usr/bin/env bash
# skill-watch — weekly scan for new Claude Code / agent tooling worth adopting.
# Run from the fleet-manager's dir. Submits at most ONE high-value idea/week.
set -e
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

AGENT_DIR="$(pwd)"
AGENT_SLUG="${AGENT_SLUG_OVERRIDE:-$(basename "$AGENT_DIR")}"
TS="$(date +%Y-%m-%d-%H%M)"
MODEL=$(agentv_agent_model "$AGENT_SLUG")
PROJECT="${SKILLWATCH_PROJECT:-$AGENT_SLUG}"
[ -f "$AGENT_DIR/CLAUDE.md" ] || { echo "ERR: not in the fleet-manager dir" >&2; exit 1; }
[ -f "$AGENT_DIR/.api-token" ] || { echo "ERR: no .api-token" >&2; exit 1; }

PROMPT="You are ${AGENT_SLUG} running weekly skill-watch. Read CLAUDE.md + MEMORY.md for context.

Procedure:
1. Recent Claude Code releases: gh release list --repo anthropics/claude-code --limit 5
2. Installed plugins in ~/.claude/plugins/cache/ — skim CHANGELOG/README.
3. Anthropic SDK releases: gh release list --repo anthropics/anthropic-sdk-node --limit 5
4. Marketplace (if reachable): npx --yes @anthropic-ai/skills search --recent 2>/dev/null || echo marketplace_unavailable
5. List candidates. Score each: impact 1-10, effort 1-10.
6. Hard filter: DISCARD any where impact < 7 OR impact < 2 × effort.
7. If any survive, submit ONLY the single best via:
   .claude/skills/shared/submit-idea/submit.sh ${PROJECT} \"<title>\" <impact> <effort> \"<body>\"
8. If nothing survives, output 'NO_IDEA_THIS_WEEK' + one sentence why.
9. End with a one-paragraph summary of what you scanned.

A blank week is healthy — never invent ideas to fill a quota. Submit at most ONE. Begin."

echo "[$TS] skill-watch agent=$AGENT_SLUG"
claude --print "$PROMPT" --model "$MODEL" \
  --allowedTools "Bash,Read,Write,Grep,Glob" \
  --dangerously-skip-permissions --no-session-persistence --max-budget-usd 1.50 2>&1
echo "[$TS] skill-watch exit=$?"
