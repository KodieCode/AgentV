#!/usr/bin/env bash
# 001 — memory-search FTS5 rollout.
#
# Ships the memory-search skill (full-text recall over an agent's memory +
# identity files) to an existing fleet. The skill files themselves arrive via
# `git pull` + the per-agent shared-skills symlink; this step does the one-time
# work that a pull can't: verify the runtime supports FTS5, then build the
# initial index for each agent on THIS host so search works immediately instead
# of only after each agent's next wrap-up.
#
# Idempotent: index build is incremental (skips unchanged files); re-running is
# cheap. Exits 75 (retry-later) if FTS5 isn't available, so the fleet isn't
# marked done until the capability can actually be delivered.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/shared/lib/agentv-env.sh"

SKILL="$SHARED_DIR/skills/memory-search/index.py"
[ -f "$SKILL" ] || { echo "  memory-search skill not present in this build — nothing to roll out"; exit 0; }

# FTS5 must be compiled into the python sqlite3 module, else every reindex (and
# the wrap-up step that calls it) throws. Probe once; skip-retry if unsupported.
if ! python3 - <<'PY' 2>/dev/null
import sqlite3
sqlite3.connect(":memory:").execute("CREATE VIRTUAL TABLE t USING fts5(x)")
PY
then
  echo "  ! python3 sqlite3 lacks FTS5 on this host — memory-search cannot run here yet."
  echo "    Install a python with FTS5 (stock Debian/Ubuntu has it) then re-run setup/update.sh."
  exit 75
fi

# Build the initial index for each active agent on this host. Best-effort per
# agent — one agent's bad dir must not abort the rollout.
built=0; failed=0
while IFS=':' read -r slug session dir; do
  [ -n "$slug" ] && [ -d "$dir" ] || continue
  if AGENT_ROOT="$dir" python3 "$SKILL" >/dev/null 2>&1; then
    built=$((built+1))
  else
    echo "  ! initial index failed for $slug ($dir) — it'll build on next wrap-up"
    failed=$((failed+1))
  fi
done < <(agentv_agent_roster)

echo "  memory-search: indexed $built agent(s)${failed:+, $failed deferred}"
exit 0
