#!/usr/bin/env bash
# provision — wire the control-plane dashboard for serving on this box.
#
#   • nginx vhost for $DASHBOARD_DOMAIN — proxies the SPA app + the /v1 API
#   • certbot SSL for that domain (Let's Encrypt, nginx plugin)
#   • pm2 registration for the API and the static app build
#
# Env-driven (DASHBOARD_DOMAIN, SERVER_PORT, optional DASHBOARD_APP_PORT).
# Idempotent: re-running updates the vhost in place and reconciles pm2.
# Guarded: no-ops cleanly (with a clear message) when nginx/certbot are absent
# or when the control-plane app/api hasn't been built/scaffolded yet.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/shared/lib/agentv-env.sh"

echo "▶ AgentV provision (dashboard serving)"

have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""
[ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"

: "${SERVER_PORT:=8100}"
APP_PORT="${DASHBOARD_APP_PORT:-$((SERVER_PORT + 1))}"
CP_API_NAME="${CONTROL_PLANE_API_PM2:-agentv-api}"
CP_APP_NAME="${CONTROL_PLANE_APP_PM2:-agentv-app}"
API_DIR="$AGENTV_ROOT/control-plane/api"
APP_DIR="$AGENTV_ROOT/control-plane/app"

# ── 1. nginx vhost + certbot ───────────────────────────────────────────────────
if [ -z "${DASHBOARD_DOMAIN:-}" ]; then
  echo "  ! DASHBOARD_DOMAIN empty in .env — skipping nginx/certbot (dashboard will only be reachable on :$APP_PORT / :$SERVER_PORT locally)"
elif ! have nginx; then
  echo "  ! nginx not installed — skipping vhost + SSL. Run setup/install-deps.sh first."
else
  echo "── nginx vhost for $DASHBOARD_DOMAIN  (app→:$APP_PORT  /v1→:$SERVER_PORT)"
  VHOST="/etc/nginx/sites-available/$DASHBOARD_DOMAIN"
  TMP_VHOST="$(mktemp)"
  cat > "$TMP_VHOST" <<NGINX
# Managed by AgentV setup/provision.sh — regenerated on each run.
server {
    listen 80;
    listen [::]:80;
    server_name $DASHBOARD_DOMAIN;

    # --- control-plane API (REST + websockets e.g. live terminal) ---
    location /v1/ {
        proxy_pass http://127.0.0.1:$SERVER_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location = /healthz {
        proxy_pass http://127.0.0.1:$SERVER_PORT/healthz;
        proxy_set_header Host \$host;
    }

    # --- dashboard SPA (served by pm2 'serve') ---
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

  if [ -n "$SUDO" ] || [ -w "$(dirname "$VHOST")" ]; then
    $SUDO cp "$TMP_VHOST" "$VHOST"
    $SUDO ln -sf "$VHOST" "/etc/nginx/sites-enabled/$DASHBOARD_DOMAIN"
    rm -f "$TMP_VHOST"
    if $SUDO nginx -t; then
      $SUDO systemctl reload nginx || $SUDO service nginx reload || true
      echo "  ✓ nginx vhost installed + reloaded"
    else
      echo "  ✗ nginx config test failed — left vhost in place, NOT reloaded" >&2
    fi

    # certbot SSL — only attempt when certbot is present.
    if have certbot; then
      EMAIL_ARG="--register-unsafely-without-email"
      [ -n "${ADMIN_NOTIFY_TO:-}" ] && EMAIL_ARG="-m $ADMIN_NOTIFY_TO"
      echo "── certbot SSL for $DASHBOARD_DOMAIN"
      # --keep-until-expiring makes this idempotent (skips reissue if a valid cert exists)
      if $SUDO certbot --nginx -d "$DASHBOARD_DOMAIN" --non-interactive --agree-tos \
            $EMAIL_ARG --redirect --keep-until-expiring; then
        echo "  ✓ SSL provisioned"
      else
        echo "  ! certbot failed (DNS not pointed yet? rate-limited?) — vhost serves on HTTP for now" >&2
      fi
    else
      echo "  ! certbot not installed — serving on HTTP only. Install it then re-run to get SSL."
    fi
  else
    rm -f "$TMP_VHOST"
    echo "  ! no write access to /etc/nginx (need sudo) — skipped vhost install" >&2
  fi
fi

# ── 2. pm2 registration (control-plane api + app) ───────────────────────────────
if ! have pm2; then
  echo "  ! pm2 not installed — skipping process registration. Run setup/install-deps.sh first."
  echo "✔ provision finished (nginx/SSL only)."
  exit 0
fi

# Register a pm2 process only if not already known. start.sh handles (re)starts.
pm2_known() { pm2 describe "$1" >/dev/null 2>&1; }

echo "── pm2: control-plane API ($CP_API_NAME)"
if [ -f "$API_DIR/package.json" ]; then
  if pm2_known "$CP_API_NAME"; then
    echo "  ✓ $CP_API_NAME already registered (start.sh will (re)start it)"
  else
    # Prefer an npm 'start' script; fall back to a conventional entrypoint.
    if node -e "process.exit(require('$API_DIR/package.json').scripts?.start?0:1)" 2>/dev/null; then
      ( cd "$API_DIR" && PORT="$SERVER_PORT" SERVER_PORT="$SERVER_PORT" \
        pm2 start npm --name "$CP_API_NAME" -- start )
    elif [ -f "$API_DIR/src/index.js" ]; then
      ( cd "$API_DIR" && PORT="$SERVER_PORT" SERVER_PORT="$SERVER_PORT" \
        pm2 start src/index.js --name "$CP_API_NAME" )
    else
      echo "  ! $API_DIR has no start script or src/index.js — skipped (control-plane API not scaffolded yet)"
    fi
  fi
else
  echo "  ⧗ control-plane API not present yet ($API_DIR) — skipping (phase C)."
fi

echo "── pm2: control-plane app build ($CP_APP_NAME, :$APP_PORT)"
if [ -d "$APP_DIR/dist" ]; then
  if pm2_known "$CP_APP_NAME"; then
    echo "  ✓ $CP_APP_NAME already registered (start.sh will (re)start it)"
  else
    pm2 serve "$APP_DIR/dist" "$APP_PORT" --spa --name "$CP_APP_NAME"
  fi
elif [ -d "$APP_DIR" ]; then
  echo "  ! $APP_DIR present but no dist/ — run 'npm run build' in control-plane/app, then re-run."
else
  echo "  ⧗ control-plane app not present yet ($APP_DIR) — skipping (phase C)."
fi

pm2 save >/dev/null 2>&1 || true
echo "✔ provision finished."
