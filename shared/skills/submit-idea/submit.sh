#!/usr/bin/env bash
# submit-idea — submit an improvement idea to the control-plane kanban.
# Reads .api-token from the calling agent's identity dir (cwd).
#   Usage: submit.sh <project_slug> <title> <impact> <effort> <body>
set -e
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

[ $# -ge 5 ] || { echo '{"error":"usage: submit.sh <project_slug> <title> <impact> <effort> <body>"}' >&2; exit 1; }
PROJECT="$1"; TITLE="$2"; IMPACT="$3"; EFFORT="$4"; BODY="$5"

AGENT_SLUG="${AGENT_SLUG_OVERRIDE:-$(basename "$(pwd)")}"
[ -f ".api-token" ] || { echo "{\"error\":\"no .api-token in $(pwd)\"}" >&2; exit 1; }
TOKEN="$(cat .api-token)"

PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'agent_slug': sys.argv[1], 'project_slug': sys.argv[2], 'title': sys.argv[3],
  'body': sys.argv[4], 'impact_score': int(sys.argv[5]), 'effort_score': int(sys.argv[6]),
}))" "$AGENT_SLUG" "$PROJECT" "$TITLE" "$BODY" "$IMPACT" "$EFFORT")

curl -sS -X POST "$CONTROL_PLANE_API/v1/ideas" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$PAYLOAD"
