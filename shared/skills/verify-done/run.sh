#!/usr/bin/env bash
# verify-done — fresh-context task completion verifier.
# Spawns a separate claude --print (no history, no anchoring) to verify a task
# objective was ACTUALLY met. Exit: 0=PASS, 1=FAIL, 2=ERROR/unverifiable.
#
# Usage:
#   run.sh --brief "..."|--brief-file P --shipped "..."|--shipped-file P [--agent SLUG] [--model M] [--strict]
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

BRIEF="" BRIEF_FILE="" SHIPPED="" SHIPPED_FILE="" MODEL="$DEFAULT_AGENT_MODEL" AGENT_SLUG="" STRICT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --brief) BRIEF="$2"; shift 2 ;;
    --brief-file) BRIEF_FILE="$2"; shift 2 ;;
    --shipped) SHIPPED="$2"; shift 2 ;;
    --shipped-file) SHIPPED_FILE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --agent) AGENT_SLUG="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    *) echo "ERR: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$BRIEF_FILE" ]] && BRIEF="$(cat "$BRIEF_FILE")"
[[ -n "$BRIEF" ]] || { echo "ERR: --brief or --brief-file required" >&2; exit 2; }
[[ -n "$SHIPPED_FILE" ]] && SHIPPED="$(cat "$SHIPPED_FILE")"
[[ -n "$SHIPPED" ]] || { echo "ERR: --shipped or --shipped-file required" >&2; exit 2; }
SHIPPED="${SHIPPED:0:8000}"; BRIEF="${BRIEF:0:4000}"

# Model from the agents table when a slug is given.
[[ -n "$AGENT_SLUG" ]] && MODEL=$(agentv_agent_model "$AGENT_SLUG")

TMPFILE=$(mktemp /tmp/verify-done-XXXXXX.txt)
trap 'rm -f "$TMPFILE"' EXIT
cat > "$TMPFILE" <<PROMPT_EOF
You are a task completion verifier. Skeptical stance — default to FAIL if there is any meaningful gap between objective and delivery.

RULES:
- Judge only what was shipped, not what might be fixed later
- Workarounds that don't address root cause = FAIL
- Partial delivery = FAIL unless the brief explicitly scoped it
- Tests passing != objective met
- Do NOT give credit for effort

## Original task objective
${BRIEF}

## What was shipped
${SHIPPED}

## Required output — use EXACTLY this format, no other text:
OBJECTIVE: <one sentence>
DELIVERED: <bullet list>
GAPS: <bullet list, or the single word: none>
VERDICT: PASS
(or 'VERDICT: FAIL — <one-line reason>' if gaps exist)
PROMPT_EOF

RESPONSE=$(claude --print --model "$MODEL" -p "$(cat "$TMPFILE")" 2>/dev/null) || {
  echo "WARNING: claude --print failed — cannot verify" >&2; [[ "$STRICT" -eq 1 ]] && exit 1; exit 2; }

if echo "$RESPONSE" | grep -qE "^VERDICT: PASS"; then
  echo "VERIFIED: objective met"; echo; echo "$RESPONSE"; exit 0
elif echo "$RESPONSE" | grep -qE "^VERDICT: FAIL"; then
  echo "NOT DONE: $(echo "$RESPONSE" | grep -E '^VERDICT: FAIL')"; echo
  echo "Gaps to fix:"; echo "$RESPONSE" | awk '/^GAPS:/{f=1} f&&!/^VERDICT:/{print} /^VERDICT:/{f=0}'
  echo; echo "Fix the gaps, then re-run verify-done before notifying."; exit 1
else
  echo "WARNING: could not parse VERDICT" >&2; echo "$RESPONSE" >&2; [[ "$STRICT" -eq 1 ]] && exit 1; exit 2
fi
