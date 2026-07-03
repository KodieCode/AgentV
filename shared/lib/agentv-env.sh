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
: "${CONTROL_PLANE_API:=http://localhost:${SERVER_PORT:-8100}}"  # dashboard API base
: "${DEFAULT_AGENT_MODEL:=claude-sonnet-5}"
: "${FLEET_MANAGER_SLUG:=fleet-manager}"        # the coordinating agent's slug
: "${FLEET_MANAGER_NAME:=Fleet Manager}"        # its display name (operator-chosen: Norman, AgentV, …)
: "${FLEET_HOST:=local}"                        # this box's agents.host value (multi-host fleets set per box)

# --- mysql helper (uses .env creds) ---
# stderr is captured to a log (not silently swallowed — a DB outage must not
# masquerade as an empty roster with every safety net no-oping). On error a
# one-line warning goes to the caller's stderr; stdout stays empty so existing
# callers keep behaving as before.
: "${AGENTV_MYSQL_ERR_LOG:=$AGENTV_ROOT/.agentv-mysql-errors.log}"
agentv_mysql() {
  local _err _rc
  _err="$(mktemp)" || { mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -B "$@" 2>/dev/null; return; }
  mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -B "$@" 2>"$_err"
  _rc=$?
  # Drop the noise line mysql prints on every invocation with -p on the CLI.
  sed -i '/Using a password on the command line/d' "$_err" 2>/dev/null
  if [ -s "$_err" ] || [ "$_rc" -ne 0 ]; then
    {
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] agentv_mysql exit=$_rc args: $*"
      cat "$_err"
    } >> "$AGENTV_MYSQL_ERR_LOG" 2>/dev/null
    echo "WARN: agentv_mysql failed (exit $_rc) — see $AGENTV_MYSQL_ERR_LOG" >&2
  fi
  rm -f "$_err"
  return "$_rc"
}

# Slug guard for helpers that interpolate a caller-supplied slug into SQL.
# Returns non-zero (and prints nothing) on anything outside the safe charset.
_agentv_valid_slug() {
  case "$1" in
    ''|*[!a-z0-9_-]*) return 1 ;;
    *) return 0 ;;
  esac
}

# --- DB-driven agent roster ---
# Emits one "slug:session:dir" line per active agent with a tmux_session ON
# THIS HOST (agents.host = FLEET_HOST) — tmux checks/launches/wakes only make
# sense locally. Replaces every hardcoded AGENTS=( ... ) array in the
# safety-net skills. dir = AGENTS_DIR/<slug> (identity-dir convention).
agentv_agent_roster() {
  agentv_mysql -e "
    SELECT CONCAT(slug, ':', tmux_session, ':', '$AGENTS_DIR/', slug)
    FROM agents
    WHERE active = 1 AND tmux_session IS NOT NULL AND tmux_session <> ''
      AND host = '$FLEET_HOST'
    ORDER BY slug;"
}

# Inbox path for an agent (convention: <dir>/notifications/inbox.jsonl).
# Slug is caller-supplied — guard before interpolating into SQL.
agentv_agent_inbox() {
  local slug="$1"
  _agentv_valid_slug "$slug" || { echo "WARN: agentv_agent_inbox: invalid slug '$slug'" >&2; return 1; }
  agentv_mysql -e "
    SELECT COALESCE(NULLIF(inbox_path,''),
                    CONCAT('$AGENTS_DIR/', slug, '/notifications/inbox.jsonl'))
    FROM agents WHERE slug = '$slug' LIMIT 1;"
}

# Model for an agent (from agents.model), falling back to the default. Replaces
# the legacy agent-model.sh path dependency — skills pass --model from this.
# Invalid slugs fall back to the default model (callers expect SOME model).
agentv_agent_model() {
  local slug="$1" m=""
  if _agentv_valid_slug "$slug"; then
    m=$(agentv_mysql -e "SELECT model FROM agents WHERE slug='$slug' LIMIT 1;")
  else
    echo "WARN: agentv_agent_model: invalid slug '$slug' — using default" >&2
  fi
  [ -n "$m" ] && echo "$m" || echo "$DEFAULT_AGENT_MODEL"
}
