#!/usr/bin/env bash
# report/save.sh — persist a human-facing briefing to the control-plane `reports`
# table so the dashboard can surface it (email optional, separate).
#
# Usage:  save.sh <kind> <agent_slug|-> <title> <body-file>
#   kind        digest | weekly_review | team_review | <custom>
#   agent_slug  the producing agent, or "-" for fleet-wide
#   title       short headline
#   body-file   path to a markdown file holding the report body
#
# Prints the new report id. Body is passed via file (never as a shell arg —
# large markdown blows the ARG_MAX limit; E2BIG).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

KIND="${1:?kind required}"
SLUG="${2:?agent_slug or - required}"; [ "$SLUG" = "-" ] && SLUG=""
TITLE="${3:?title required}"
BODYFILE="${4:?body file required}"
[ -f "$BODYFILE" ] || { echo "body file not found: $BODYFILE" >&2; exit 1; }

# Insert via node (parameterised — safe for arbitrary markdown).
# mysql2/dotenv come from the bootstrapped db deps.
export NODE_PATH="$AGENTV_ROOT/db/node_modules${NODE_PATH:+:$NODE_PATH}"
node - "$KIND" "$SLUG" "$TITLE" "$BODYFILE" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.AGENTV_ROOT || path.resolve(__dirname || '.', '../../..');
require('dotenv').config({ path: path.join(root, '.env'), override: true });
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const [kind, slug, title, bodyFile] = process.argv.slice(2);
const body = fs.readFileSync(bodyFile, 'utf8');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  });
  const id = crypto.randomUUID();
  await c.execute(
    'INSERT INTO reports (id, kind, agent_slug, title, body_md, created_at) VALUES (?,?,?,?,?,NOW())',
    [id, kind, slug || null, title, body]
  );
  await c.end();
  console.log(id);
})().catch((e) => { console.error(e.message); process.exit(1); });
NODE
