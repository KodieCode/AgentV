#!/usr/bin/env bash
# start — bring the fleet online.
#
#   • (re)start the control-plane API + the static app build under pm2
#   • regenerate notify routing.conf from the DB roster
#   • launch each active agent's long-lived tmux session running `claude`
#     (model from the DB, --permission-mode auto, named for remote-control)
#
# Idempotent: pm2 procs are restarted if present / started if not; tmux
# sessions are only created when missing. Guarded: no-ops cleanly when the
# control-plane isn't scaffolded yet or pm2/claude aren't installed.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/shared/lib/agentv-env.sh"

echo "▶ AgentV start"

have() { command -v "$1" >/dev/null 2>&1; }

: "${SERVER_PORT:=8100}"
APP_PORT="${DASHBOARD_APP_PORT:-$((SERVER_PORT + 1))}"
CP_API_NAME="${CONTROL_PLANE_API_PM2:-agentv-api}"
CP_APP_NAME="${CONTROL_PLANE_APP_PM2:-agentv-app}"
API_DIR="$AGENTV_ROOT/control-plane/api"
APP_DIR="$AGENTV_ROOT/control-plane/app"
# Friendly server label for remote-control display names (no hardcoded site code).
SERVER_LABEL="${SERVER_LABEL:-$(hostname -s 2>/dev/null || echo server)}"

# ── 1. control-plane processes ──────────────────────────────────────────────────
if have pm2; then
  pm2_known() { pm2 describe "$1" >/dev/null 2>&1; }

  echo "── control-plane API ($CP_API_NAME)"
  if pm2_known "$CP_API_NAME"; then
    pm2 restart "$CP_API_NAME" --update-env
    echo "  ✓ restarted"
  elif [ -f "$API_DIR/package.json" ]; then
    if node -e "process.exit(require('$API_DIR/package.json').scripts?.start?0:1)" 2>/dev/null; then
      ( cd "$API_DIR" && PORT="$SERVER_PORT" SERVER_PORT="$SERVER_PORT" \
        pm2 start npm --name "$CP_API_NAME" -- start )
    elif [ -f "$API_DIR/src/index.js" ]; then
      ( cd "$API_DIR" && PORT="$SERVER_PORT" SERVER_PORT="$SERVER_PORT" \
        pm2 start src/index.js --name "$CP_API_NAME" )
    else
      echo "  ! no start script / src/index.js in $API_DIR — skipped"
    fi
  else
    echo "  ⧗ control-plane API not present yet — skipping (phase C)."
  fi

  echo "── control-plane app ($CP_APP_NAME, :$APP_PORT)"
  if pm2_known "$CP_APP_NAME"; then
    pm2 restart "$CP_APP_NAME" --update-env
    echo "  ✓ restarted"
  elif [ -d "$APP_DIR/dist" ]; then
    pm2 serve "$APP_DIR/dist" "$APP_PORT" --spa --name "$CP_APP_NAME"
  elif [ -d "$APP_DIR" ]; then
    echo "  ! $APP_DIR present but no dist/ — run 'npm run build' in control-plane/app."
  else
    echo "  ⧗ control-plane app not present yet — skipping (phase C)."
  fi

  pm2 save >/dev/null 2>&1 || true
else
  echo "  ! pm2 not installed — skipping control-plane processes. Run setup/install-deps.sh."
fi

# ── 2. notify routing.conf (DB-driven) ──────────────────────────────────────────
ROUTING_GEN="$SHARED_DIR/skills/notify/generate-routing-conf.sh"
if [ -x "$ROUTING_GEN" ]; then
  echo "── regenerating notify routing.conf from DB"
  "$ROUTING_GEN" || echo "  ! routing.conf generation failed (no active agents yet?) — continuing"
fi

# ── 3. agent tmux sessions ──────────────────────────────────────────────────────
if ! have tmux; then
  echo "  ! tmux not installed — cannot launch agent sessions. Run setup/install-deps.sh."
  echo "✔ start finished (control-plane only)."
  exit 0
fi
if ! have claude; then
  echo "  ! claude CLI not installed/authenticated — skipping agent sessions."
  echo "    Install Claude Code + run 'claude' /login once, then re-run setup/start.sh."
  echo "✔ start finished (control-plane only)."
  exit 0
fi

echo "── launching agent tmux sessions"
launched=0; alive=0
# Roster lines: slug:session:dir  (DB-driven, no hardcoded roster)
while IFS=':' read -r slug session dir; do
  [ -n "$slug" ] && [ -n "$session" ] || continue
  if tmux has-session -t "$session" 2>/dev/null; then
    echo "  ✓ $slug ($session) already alive"
    alive=$((alive+1))
    continue
  fi
  model="$(agentv_agent_model "$slug")"
  # Friendly display name for Claude Desktop remote-control.
  name="$(agentv_mysql -e "SELECT name FROM agents WHERE slug='$slug' LIMIT 1;")"
  [ -n "$name" ] || name="$slug"
  display="$name ($SERVER_LABEL)"
  cwd="$dir"; [ -d "$cwd" ] || cwd="$AGENTS_DIR/$slug"

  echo "  • starting $slug → '$display'  model=$model  cwd=$cwd"
  tmux new-session -d -s "$session" -c "$cwd"
  tmux send-keys -t "$session" \
    "claude --permission-mode auto --model $model --remote-control \"$display\"" Enter
  launched=$((launched+1))
  sleep 8
done < <(agentv_agent_roster)

echo "  agents: $alive already up, $launched launched"
echo "✔ start finished."
