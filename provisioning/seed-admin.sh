#!/usr/bin/env bash
# seed-admin — create the dashboard login user so the operator can actually sign
# in. Without this the control-plane serves a login page against an empty `users`
# table and there is no way in. Idempotent: skips if the username already exists.
#
# Credentials come from .env (written by configure.sh):
#   ADMIN_USERNAME  (default: admin)
#   ADMIN_PASSWORD  (if empty, a strong one is generated and printed ONCE)
#
# Password hashing uses bcrypt from control-plane/api/node_modules, so this must
# run AFTER that package's deps are installed (bootstrap does).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../shared/lib/agentv-env.sh"

USERNAME="${ADMIN_USERNAME:-admin}"
API_DIR="$AGENTV_ROOT/control-plane/api"

# Escape for single-quoted SQL literals: backslashes first, then quotes.
sql_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"; }

echo "── seed dashboard admin ('$USERNAME')"

# Already present? (idempotent re-runs / repeated bootstraps)
existing="$(agentv_mysql -e "SELECT username FROM users WHERE username='$(sql_esc "$USERNAME")' LIMIT 1;")"
if [ -n "$existing" ]; then
  echo "  ✓ admin '$USERNAME' already exists — leaving password unchanged"
  exit 0
fi

# Need bcrypt (from the API package) to hash the password.
if [ ! -d "$API_DIR/node_modules/bcrypt" ]; then
  echo "  ! bcrypt not installed in $API_DIR — run bootstrap (installs API deps) first" >&2
  exit 1
fi

PASSWORD="${ADMIN_PASSWORD:-}"
GENERATED=0
if [ -z "$PASSWORD" ]; then
  PASSWORD="$(openssl rand -base64 18 2>/dev/null | tr -d '/+=' | cut -c1-20)"
  GENERATED=1
fi

HASH="$(cd "$API_DIR" && node -e "console.log(require('bcrypt').hashSync(process.argv[1],10))" "$PASSWORD")"
agentv_mysql -e "INSERT INTO users (id, username, password_hash) VALUES (UUID(), '$(sql_esc "$USERNAME")', '$(sql_esc "$HASH")');"

echo "  ✓ admin '$USERNAME' created"
if [ "$GENERATED" -eq 1 ]; then
  echo "  ┌───────────────────────────────────────────────"
  echo "  │ Dashboard login (SAVE THIS — shown once):"
  echo "  │   username: $USERNAME"
  echo "  │   password: $PASSWORD"
  echo "  └───────────────────────────────────────────────"
fi
