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
if [ -d control-plane/app ] && [ -f control-plane/app/package.json ]; then (cd control-plane/app && npm install --no-audit --no-fund); fi

# 3. migrate — build the control-plane schema
echo "── [3/6] migrate (control-plane schema)"
if [ -f db/package.json ]; then
  (cd db && npx knex migrate:latest --knexfile knexfile.js)
else
  echo "  ! db/ not yet a node package — run: cd db && npm init -y && npm i knex mysql2 dotenv (phase A wiring)"
fi

# 4. seed starter agents                                   [phase D]
echo "── [4/6] seed starter agents"
if [ -x provisioning/seed-starter-agents.sh ]; then provisioning/seed-starter-agents.sh; else echo "  ⧗ pending (phase D)"; fi

# 5. provision — nginx/certbot/pm2/tmux for dashboard+agents  [phase C/D]
echo "── [5/6] provision (nginx/certbot/pm2/tmux)"
if [ -x setup/provision.sh ]; then setup/provision.sh; else echo "  ⧗ pending (phase C/D)"; fi

# 6. start                                                 [phase C/D]
echo "── [6/6] start dashboard + agents"
if [ -x setup/start.sh ]; then setup/start.sh; else echo "  ⧗ pending (phase C/D)"; fi

echo "✔ bootstrap finished (phases marked ⧗ land in later versions — see ONBOARDING.md)"
