#!/usr/bin/env bash
# run-upgrade-steps — apply capability rollouts to an existing AgentV install.
#
# DB migrations (knex) evolve the SCHEMA. Upgrade-steps evolve everything else a
# running fleet needs when it pulls a newer AgentV: new shared skills that need
# a one-time init (build an FTS index), new safety-net crons, doctrine syncs,
# data backfills. Each step is an idempotent script in setup/upgrade-steps/,
# numbered NNN_name.sh, run in order, recorded in a ledger so it only pays its
# cost once. Adding a future rollout = drop in the next numbered step.
#
# A step's exit code is its verdict:
#   0   applied (or already-satisfied) → recorded, never re-run
#   75  not-applicable-yet / skipped   → NOT recorded, retried on next update
#   *   failed                         → NOT recorded, run-upgrade-steps aborts
#
# Steps must be safe to re-run (idempotent) even though the ledger normally
# gates them — `--rerun` ignores the ledger and runs every step again.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/shared/lib/agentv-env.sh"

STEPS_DIR="$AGENTV_ROOT/setup/upgrade-steps"
RERUN=0
[ "${1:-}" = "--rerun" ] && RERUN=1

[ -d "$STEPS_DIR" ] || { echo "  ⧗ no upgrade-steps/ — nothing to apply"; exit 0; }

# Ledger of applied steps. Kept in the control-plane DB (survives a repo
# re-clone) — created on first run.
agentv_mysql -e "CREATE TABLE IF NOT EXISTS agentv_upgrade_steps (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;" >/dev/null 2>&1 || {
  echo "  ! could not ensure upgrade-steps ledger (DB down?) — aborting capability sync" >&2
  exit 1
}

_applied() { agentv_mysql -e "SELECT 1 FROM agentv_upgrade_steps WHERE id='$1' LIMIT 1;" 2>/dev/null; }
_record()  { agentv_mysql -e "INSERT IGNORE INTO agentv_upgrade_steps (id) VALUES ('$1');" >/dev/null 2>&1; }

ran=0; skipped=0; already=0
shopt -s nullglob
for step in "$STEPS_DIR"/[0-9]*.sh; do
  id="$(basename "$step" .sh)"
  # slug-guard the id before it touches SQL.
  case "$id" in *[!a-z0-9_-]*) echo "  ! skipping oddly-named step '$id'"; continue ;; esac

  if [ "$RERUN" = 0 ] && [ -n "$(_applied "$id")" ]; then
    already=$((already+1)); continue
  fi

  echo "── upgrade-step: $id"
  set +e
  bash "$step"
  rc=$?
  set -e
  case "$rc" in
    0)  _record "$id"; echo "  ✓ $id applied"; ran=$((ran+1)) ;;
    75) echo "  ⧗ $id skipped (not applicable yet) — will retry next update"; skipped=$((skipped+1)) ;;
    *)  echo "  ✗ $id FAILED (exit $rc) — aborting; fix and re-run setup/update.sh" >&2; exit "$rc" ;;
  esac
done

echo "  upgrade-steps: $ran applied, $already already-current, $skipped skipped"
