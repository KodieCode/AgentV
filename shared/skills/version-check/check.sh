#!/usr/bin/env bash
# version-check — is a newer AgentV available on the branch this install tracks?
#
# Every install is a git clone, so the check is just: fetch the tracked branch,
# compare local HEAD/VERSION against origin's. Writes the result into the
# agentv_meta key/value table; the dashboard's /v1/version endpoint reads it to
# show an update banner, and the nightly cron notifies the fleet-manager when
# behind. Notify-only — it NEVER runs the update itself.
#
# Fails safe: any error (offline, no remote, detached HEAD) records a reason and
# leaves the "behind" count at 0 so a network blip never cries wolf.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../lib" && pwd)/agentv-env.sh"

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# upsert one meta key. value is single-quote-escaped for the SQL literal.
_meta() {
  local k="$1" v="$2"
  v="${v//\'/\'\'}"
  agentv_mysql -e "INSERT INTO agentv_meta (k, v, updated_at) VALUES ('$k','$v','$now')
    ON DUPLICATE KEY UPDATE v=VALUES(v), updated_at=VALUES(updated_at);" >/dev/null 2>&1
}

_fail() {  # record an error state + a 0 behind-count, then exit clean (not a cron failure)
  echo "  version-check: $1"
  _meta version_error "$1"
  _meta version_behind "0"
  _meta version_checked_at "$now"
  exit 0
}

command -v git >/dev/null 2>&1 || _fail "git not available"
git -C "$AGENTV_ROOT" rev-parse --git-dir >/dev/null 2>&1 || _fail "not a git checkout"

branch="$(git -C "$AGENTV_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
[ "$branch" != "HEAD" ] || _fail "detached HEAD — can't determine tracked branch"
git -C "$AGENTV_ROOT" remote get-url origin >/dev/null 2>&1 || _fail "no origin remote"

# Fetch quietly; a failure here is almost always transient (offline).
git -C "$AGENTV_ROOT" fetch --quiet origin "$branch" 2>/dev/null || _fail "fetch failed (offline?)"

current="$(tr -d '[:space:]' < "$AGENTV_ROOT/VERSION" 2>/dev/null || echo unknown)"
latest="$(git -C "$AGENTV_ROOT" show "origin/$branch:VERSION" 2>/dev/null | tr -d '[:space:]')"
[ -n "$latest" ] || latest="$current"
behind="$(git -C "$AGENTV_ROOT" rev-list --count "HEAD..origin/$branch" 2>/dev/null || echo 0)"

_meta version_current "$current"
_meta version_latest  "$latest"
_meta version_branch  "$branch"
_meta version_behind  "$behind"
_meta version_checked_at "$now"
_meta version_error   ""   # clear any prior error

if [ "${behind:-0}" -gt 0 ]; then
  echo "  version-check: behind by $behind commit(s) — local $current, latest $latest on $branch"
  # Nightly notifier: tell the fleet-manager, without waking (never urgent).
  NOTIFY="$SHARED_DIR/skills/notify/notify.sh"
  if [ "${VERSION_CHECK_NOTIFY:-1}" = "1" ] && [ -x "$NOTIFY" ] && [ -n "${FLEET_MANAGER_SLUG:-}" ]; then
    "$NOTIFY" --to "$FLEET_MANAGER_SLUG" --from version-check \
      "AgentV $latest is available (you're on $current, $behind commit(s) behind). Run: git pull && bash setup/update.sh" \
      >/dev/null 2>&1 || true
  fi
else
  echo "  version-check: up to date ($current on $branch)"
fi
