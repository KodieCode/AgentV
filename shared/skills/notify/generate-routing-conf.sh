#!/usr/bin/env bash
# generate-routing-conf — build routing.conf from the agents table.
# The control-plane API regenerates this on every agent CRUD; run manually after
# the first migration/seed. Inbox path defaults to the AGENTS_DIR convention when
# a row doesn't set inbox_path explicitly.
#   Usage: generate-routing-conf.sh [--dry-run]
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"
OUT="$(dirname "${BASH_SOURCE[0]}")/routing.conf"

CONTENT=$(agentv_mysql -e "
  SELECT slug,
         COALESCE(NULLIF(inbox_path,''), CONCAT('$AGENTS_DIR/', slug, '/notifications/inbox.jsonl')),
         tmux_session
  FROM agents
  WHERE active=1 AND tmux_session IS NOT NULL AND tmux_session <> ''
  ORDER BY slug;")

[ -n "$CONTENT" ] || { echo "ERR: no active agents with a session — seed agents first" >&2; exit 1; }

HEADER="# Auto-generated from the agents table — do not edit manually."$'\n'"# Regenerated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"$'\n'"# Format: slug<TAB>inbox_path<TAB>tmux_session"

if [ "${1:-}" = "--dry-run" ]; then
  printf '%s\n%s\n' "$HEADER" "$CONTENT"; echo "(dry-run — not written)"; exit 0
fi
printf '%s\n%s\n' "$HEADER" "$CONTENT" > "$OUT"
echo "Written: $OUT ($(echo "$CONTENT" | wc -l) agents)"
