#!/usr/bin/env bash
# bootstrap — orchestrate a full AgentV onboarding.
# Idempotent where possible. Run from the repo root after filling .env.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "▶ AgentV bootstrap"

# 1. preflight (tools, env, DB)
echo "── [1/6] preflight"
bash setup/preflight.sh

# 2. install deps (control-plane + db tooling)
echo "── [2/6] install"
if [ -f db/package.json ]; then (cd db && npm install --no-audit --no-fund); fi
if [ -d control-plane/api ] && [ -f control-plane/api/package.json ]; then (cd control-plane/api && npm install --no-audit --no-fund); fi
if [ -d control-plane/app ] && [ -f control-plane/app/package.json ]; then (cd control-plane/app && npm install --no-audit --no-fund --include=dev); fi

# 3. migrate — build the control-plane schema
echo "── [3/6] migrate (control-plane schema)"
if [ -f db/package.json ]; then
  (cd db && npx knex migrate:latest --knexfile knexfile.js)
else
  echo "  ! db/ not yet a node package — run: cd db && npm init -y && npm i knex mysql2 dotenv (phase A wiring)"
fi

# 4. seed the fleet-manager (the ONLY starter agent — it creates the rest later)
echo "── [4/6] seed fleet-manager"
if [ -x provisioning/seed-fleet-manager.sh ]; then
  provisioning/seed-fleet-manager.sh
else
  echo "  ⧗ provisioning/seed-fleet-manager.sh missing — skipping seed"
fi

# 4b. regenerate notify routing.conf from whatever agents now exist in the DB.
if [ -x shared/skills/notify/generate-routing-conf.sh ]; then
  echo "── regenerating notify routing.conf"
  shared/skills/notify/generate-routing-conf.sh || echo "  ! routing.conf gen skipped (no active agents yet)"
fi

# 5. provision — nginx/certbot for the dashboard + pm2 registration
echo "── [5/7] provision (nginx/certbot/pm2)"
if [ -x setup/provision.sh ]; then setup/provision.sh; else echo "  ⧗ setup/provision.sh missing"; fi

# 5b. build the dashboard app pointed at the right API URL (VITE_API_URL).
echo "── [6/7] build dashboard app"
if [ -x setup/build-app.sh ]; then setup/build-app.sh; else echo "  ⧗ setup/build-app.sh missing"; fi

# 6. start — (re)start control-plane processes + launch agent tmux sessions
echo "── [7/7] start dashboard + agents"
if [ -x setup/start.sh ]; then setup/start.sh; else echo "  ⧗ setup/start.sh missing"; fi

echo "✔ bootstrap finished — see ONBOARDING.md for verification steps."
