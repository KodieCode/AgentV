#!/usr/bin/env bash
# preflight — verify system prerequisites + a reachable control-plane DB before bootstrap.
# Exit non-zero if anything required is missing.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a || { echo "✗ no .env — cp .env.example .env and fill it"; exit 1; }

fail=0
need() {
  if command -v "$1" >/dev/null 2>&1; then
    printf "  ✓ %-12s %s\n" "$1" "$($1 --version 2>/dev/null | head -1)"
  else
    printf "  ✗ %-12s MISSING\n" "$1"; fail=1
  fi
}
echo "== system tools =="
for t in node npm pm2 nginx certbot tmux mysql git gh jq claude; do need "$t"; done

echo "== env =="
# Required to launch the control plane:
for v in MYSQL_HOST MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE JWT_SECRET; do
  if [ -n "${!v:-}" ]; then printf "  ✓ %s set\n" "$v"; else printf "  ✗ %s empty\n" "$v"; fail=1; fi
done
# Optional (only needed when the fleet builds public apps / wants SSL) — warn, don't fail:
for v in APP_DOMAIN_BASE DASHBOARD_DOMAIN GITHUB_ORG; do
  [ -n "${!v:-}" ] && printf "  ✓ %s set\n" "$v" || printf "  · %s unset (optional)\n" "$v"
done

echo "== database reachable =="
if mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SELECT 1" >/dev/null 2>&1; then
  echo "  ✓ MySQL reachable"
  mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" 2>/dev/null \
    && echo "  ✓ control-plane DB '$MYSQL_DATABASE' present" || { echo "  ✗ cannot create DB '$MYSQL_DATABASE'"; fail=1; }
else
  echo "  ✗ MySQL not reachable with .env creds"; fail=1
fi

[ "$fail" -eq 0 ] && echo "preflight: OK" || { echo "preflight: FAILED — fix the ✗ items"; exit 1; }
