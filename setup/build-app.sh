#!/usr/bin/env bash
# build-app — build the dashboard SPA pointed at the right API URL.
# The API is served at <dashboard>/v1 (provision.sh proxies it), so the app
# calls the same origin. Derives VITE_API_URL:
#   - DASHBOARD_DOMAIN set  -> https://$DASHBOARD_DOMAIN   (public, same-origin /v1)
#   - otherwise             -> http://localhost:$SERVER_PORT  (local dev)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../shared/lib/agentv-env.sh"

APP_DIR="$AGENTV_ROOT/control-plane/app"
[ -d "$APP_DIR" ] || { echo "  ⧗ control-plane/app missing — skip build"; exit 0; }
: "${SERVER_PORT:=8100}"

if [ -n "${DASHBOARD_DOMAIN:-}" ]; then
  API_URL="https://$DASHBOARD_DOMAIN"
else
  API_URL="http://localhost:$SERVER_PORT"
fi

echo "VITE_API_URL=$API_URL" > "$APP_DIR/.env"
echo "── building dashboard app (VITE_API_URL=$API_URL)"
( cd "$APP_DIR" && npm install --no-audit --no-fund && npm run build )
echo "  ✓ app built → control-plane/app/dist"
