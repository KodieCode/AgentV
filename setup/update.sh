#!/usr/bin/env bash
# update — upgrade an EXISTING AgentV install in place.
#
# The core guarantee: running agent tmux sessions are NEVER touched. Agents are
# independent processes and their skills are symlinked to this repo, so pulling
# newer code + migrating the schema + restarting only the control-plane brings
# the system forward while every agent keeps working. Agents absorb the new
# code lazily — updated skill files take effect on their next skill invocation;
# CLAUDE.md / doctrine changes take effect on their next session rotate.
#
# What it does, in order:
#   1. pull newer code (fast-forward only — refuses on local divergence)
#   2. npm install (db + control-plane) so deps match the new code
#   3. knex migrate:latest — additive schema migrations
#   4. run-upgrade-steps — capability rollouts (new skills' one-time init,
#      new crons, backfills) that a pull alone can't deliver
#   5. regenerate notify routing.conf from the DB
#   6. install-crons — pick up any NEW safety-net crons (idempotent)
#   7. rebuild the dashboard app
#   8. restart the CONTROL-PLANE pm2 procs ONLY (agentv-api / agentv-app)
#   9. report which running agents predate this update (so you can rotate them
#      when convenient — they are NOT restarted for you)
#
# Safe to run repeatedly. Run from the repo root after committing/stashing any
# local edits to tracked files.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
. "$ROOT/shared/lib/agentv-env.sh"

have() { command -v "$1" >/dev/null 2>&1; }
UPDATE_START="$(date -u +%s)"

echo "▶ AgentV update (in place)"

# ── 0. sanity ───────────────────────────────────────────────────────────────
[ -f "$ROOT/.env" ] || { echo "  ! no .env — this looks like an unconfigured checkout, not an install. Run setup/bootstrap.sh first." >&2; exit 1; }
have git || { echo "  ! git not found" >&2; exit 1; }

PREV_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
PREV_VERSION="$(cat "$ROOT/VERSION" 2>/dev/null || echo unknown)"

# Refuse to pull over uncommitted changes to TRACKED files — a silent stash/
# discard could eat an operator's local fix. Untracked files (.env, data/,
# dist/) are fine and expected.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "  ! working tree has uncommitted changes to tracked files:" >&2
  git status --short --untracked-files=no >&2
  echo "    commit or stash them, then re-run setup/update.sh." >&2
  exit 1
fi

# ── 1. pull ─────────────────────────────────────────────────────────────────
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"
echo "── [1/9] pull latest ($BRANCH)"
git fetch --quiet origin "$BRANCH" || { echo "  ! git fetch failed" >&2; exit 1; }
if ! git merge --ff-only "origin/$BRANCH"; then
  echo "  ! local branch has diverged from origin/$BRANCH — resolve by hand (rebase/merge), then re-run." >&2
  exit 1
fi
NEW_REF="$(git rev-parse --short HEAD)"
if [ "$NEW_REF" = "$PREV_REF" ]; then
  echo "  already at $NEW_REF — no new code. Re-running migrations + steps anyway (idempotent)."
else
  echo "  $PREV_REF → $NEW_REF"
fi

# ── 2. deps ─────────────────────────────────────────────────────────────────
echo "── [2/9] install deps"
[ -f db/package.json ] && (cd db && npm install --no-audit --no-fund --silent) || true
[ -f control-plane/api/package.json ] && (cd control-plane/api && npm install --no-audit --no-fund --silent) || true
[ -f control-plane/app/package.json ] && (cd control-plane/app && npm install --no-audit --no-fund --silent --include=dev) || true

# ── 3. schema migrations (additive) ─────────────────────────────────────────
echo "── [3/9] migrate schema"
if [ -f db/package.json ]; then
  (cd db && npx knex migrate:latest --knexfile knexfile.js)
else
  echo "  ⧗ db/ not a node package — skipping migrate"
fi

# ── 4. capability rollouts ──────────────────────────────────────────────────
echo "── [4/9] capability upgrade-steps"
bash setup/run-upgrade-steps.sh

# ── 5. routing ──────────────────────────────────────────────────────────────
echo "── [5/9] regenerate notify routing.conf"
if [ -x shared/skills/notify/generate-routing-conf.sh ]; then
  shared/skills/notify/generate-routing-conf.sh || echo "  ! routing.conf gen skipped"
fi

# ── 6. safety-net crons (new ones only; idempotent) ─────────────────────────
echo "── [6/9] refresh safety-net crons"
[ -x setup/install-crons.sh ] && setup/install-crons.sh || echo "  ⧗ install-crons.sh missing"

# ── 7. rebuild dashboard ────────────────────────────────────────────────────
echo "── [7/9] rebuild dashboard app"
[ -x setup/build-app.sh ] && setup/build-app.sh || echo "  ⧗ build-app.sh missing — skipping"

# ── 8. restart CONTROL-PLANE ONLY ───────────────────────────────────────────
# Agents are NOT restarted. This touches the API + static app pm2 procs only.
echo "── [8/9] restart control-plane (agents untouched)"
CP_API_NAME="${CONTROL_PLANE_API_PM2:-agentv-api}"
CP_APP_NAME="${CONTROL_PLANE_APP_PM2:-agentv-app}"
if have pm2; then
  for proc in "$CP_API_NAME" "$CP_APP_NAME"; do
    if pm2 describe "$proc" >/dev/null 2>&1; then
      pm2 restart "$proc" --update-env >/dev/null && echo "  ✓ restarted $proc"
    else
      echo "  ⧗ $proc not under pm2 — run setup/start.sh once to register it"
    fi
  done
else
  echo "  ⧗ pm2 not installed — control-plane not restarted"
fi

# ── 9. report agents running pre-update code ────────────────────────────────
echo "── [9/9] agent status"
stale=0; total=0
while IFS=':' read -r slug session dir; do
  [ -n "$slug" ] && [ -n "$session" ] || continue
  total=$((total+1))
  created="$(tmux display -p -t "$session" '#{session_created}' 2>/dev/null || echo 0)"
  if [ "$created" != 0 ] && [ "$created" -lt "$UPDATE_START" ]; then
    stale=$((stale+1))
    echo "  • $slug — running since before this update (rotate to pick up CLAUDE.md/doctrine changes)"
  fi
done < <(agentv_agent_roster)
if [ "$total" = 0 ]; then
  echo "  (no agents on this host)"
elif [ "$stale" = 0 ]; then
  echo "  all agents already started after this update"
else
  echo "  $stale/$total agent(s) predate the update — updated SKILL files apply on next use;"
  echo "  CLAUDE.md/doctrine changes need a rotate. Rotate at your convenience; nothing was killed."
fi

# version marker (gitignored — per-install state)
printf '%s\n' "${NEW_REF}" > "$ROOT/.agentv-version"
echo "✔ update finished: $PREV_VERSION($PREV_REF) → $(cat VERSION 2>/dev/null || echo '?')($NEW_REF)"
