#!/usr/bin/env bash
# agentv-env.sh — common helpers sourced by AgentV shared skills.
# Resolves the repo root, loads .env, and exposes DB-driven helpers so NOTHING
# hardcodes an agent roster, host, or path. Source this at the top of a skill:
#   . "$(dirname "$0")/../lib/agentv-env.sh"   (adjust depth as needed)

# --- repo root + .env ---
# Walk up from this file to the repo root (dir containing .env.example).
_AGENTV_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTV_ROOT="$(cd "$_AGENTV_LIB/../.." && pwd)"
if [ -f "$AGENTV_ROOT/.env" ]; then
  set -a; . "$AGENTV_ROOT/.env"; set +a
fi
: "${AGENTS_DIR:=$AGENTV_ROOT/agents}"
: "${SHARED_DIR:=$AGENTV_ROOT/shared}"
: "${TEAM_ACTIVITY:=$SHARED_DIR/team_activity.jsonl}"   # cross-agent message log

# --- mysql helper (uses .env creds) ---
agentv_mysql() {
  mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -B "$@" 2>/dev/null
}

# --- DB-driven agent roster ---
# Emits one "slug:session:dir" line per active agent with a tmux_session.
# Replaces every hardcoded AGENTS=( ... ) array in the safety-net skills.
# dir = AGENTS_DIR/<slug> (identity-dir convention).
agentv_agent_roster() {
  agentv_mysql -e "
    SELECT CONCAT(slug, ':', tmux_session, ':', '$AGENTS_DIR/', slug)
    FROM agents
    WHERE active = 1 AND tmux_session IS NOT NULL AND tmux_session <> ''
    ORDER BY slug;"
}

# Inbox path for an agent (convention: <dir>/notifications/inbox.jsonl).
agentv_agent_inbox() {
  local slug="$1"
  agentv_mysql -e "
    SELECT COALESCE(NULLIF(inbox_path,''),
                    CONCAT('$AGENTS_DIR/', slug, '/notifications/inbox.jsonl'))
    FROM agents WHERE slug = '$slug' LIMIT 1;"
}
