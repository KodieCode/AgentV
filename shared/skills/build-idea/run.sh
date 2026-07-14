#!/usr/bin/env bash
# build-idea — implement an approved kanban idea. Called by the agent_build_idea
# builtin. Runs claude --print in the agent's dir to make the change + open a PR.
# Args: $1=project_slug $2=idea_id $3=title $4=body
# Env:  AGENT_SLUG_OVERRIDE, AGENT_DIR_OVERRIDE, AGENT_MODEL_OVERRIDE
# Contract: emit "PR_URL=https://..." on success, or "BLOCKED: <reason>" to halt.
set -e
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

PROJECT_SLUG="${1:-}"; IDEA_ID="${2:-}"; TITLE="${3:-}"; BODY="${4:-}"
AGENT_SLUG="${AGENT_SLUG_OVERRIDE:-$(basename "$(pwd)")}"
AGENT_DIR="${AGENT_DIR_OVERRIDE:-$(pwd)}"
MODEL="${AGENT_MODEL_OVERRIDE:-$(agentv_agent_model "$AGENT_SLUG")}"
ORG="${GITHUB_ORG:-}"
TS="$(date +%Y-%m-%d-%H%M)"

[ -n "$IDEA_ID" ] || { echo "BLOCKED: missing idea_id arg" >&2; exit 1; }
[ -f "$AGENT_DIR/CLAUDE.md" ] || { echo "BLOCKED: not in an agent dir (no CLAUDE.md)" >&2; exit 1; }

echo "[$TS] build-idea: agent=$AGENT_SLUG idea=$IDEA_ID project=$PROJECT_SLUG model=$MODEL"

PROMPT="You are ${AGENT_SLUG}, implementing an approved idea from the kanban.

Idea ID: $IDEA_ID
Project: $PROJECT_SLUG
Title: $TITLE

Body:
$BODY

---
Procedure:
1. Identify which repo this idea belongs to — see PROJECT-MAP.md in your agent dir for the
   project(s) you own and their local paths + GitHub repos. Pick the repo + exact file(s).
2. If the target repo or change is ambiguous, output 'BLOCKED: <reason>' and stop.
3. In the target repo, create a feature branch: agent/${AGENT_SLUG}/<idea-title-slug>-${IDEA_ID:0:8}
   (idea-title-slug = lowercase, hyphens, max 30 chars)
4. Make the change. Read existing files first; follow the repo's conventions.
5. Stage + commit (conventional-commits, ONE commit): git add <files> && git commit -m '<type>(<scope>): <desc>'
6. Push: git push -u origin <branch>
7. Open a PR: gh pr create --title '<title>' --body '<what changed + why>' --repo ${ORG:-<org>}/<repo>
8. On success output EXACTLY these two lines, nothing after:
   PR_URL=<full PR URL>
   branch=<branch name>

Hard rules:
- Never push to main on any repo
- Never commit .env files or secrets
- One commit only
- If you can't implement cleanly, output 'BLOCKED: <reason>' and stop"

EXIT=0
claude --print "$PROMPT" \
  --model "$MODEL" \
  --allowedTools "Bash,Read,Edit,Write,Grep,Glob" \
  --permission-mode auto \
  --no-session-persistence \
  --max-budget-usd 3.00 2>&1 || EXIT=$?
echo "[$TS] build-idea exit=$EXIT"
exit $EXIT
