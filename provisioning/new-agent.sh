#!/usr/bin/env bash
# ============================================================================
# new-agent.sh — scripted provisioning of an AgentV fleet agent.
#
# A generalised, env-driven, idempotent version of the 15-step "create a new
# agent" flow. Re-running it for an existing slug is safe: it upserts the DB row,
# leaves existing identity files untouched (unless --force), and only mints a
# token / regenerates routing when needed.
#
# Everything that isn't a true argument comes from the repo .env via
# shared/lib/agentv-env.sh — NOTHING here hardcodes a host, DB, API URL, org,
# or another agent's slug.
#
# Usage:
#   provisioning/new-agent.sh --slug <slug> --name "<Display Name>" --role "<one-line>" [options]
#
# Options:
#   --slug         <slug>        required. lowercase-kebab-case. unique.
#   --name         "<name>"      required. display name.
#   --role         "<text>"      required. one-line role description.
#   --model        <model>       agent model (default: $DEFAULT_AGENT_MODEL).
#   --tmux         <session>     tmux session name (default: <slug>).
#   --inbox        <path>        inbox path (default: AGENTS_DIR/<slug>/notifications/inbox.jsonl).
#   --reports-to   <text>        reporting line (default: "the fleet-manager").
#   --fleet-manager <slug>       fleet-manager slug for notify defaults (default: fleet-manager).
#   --server-code  <code>        short host code for display name, e.g. CP (default: CP).
#   --projects     "<text>"      free-text seed for PROJECT-MAP {{PROJECTS}} (default: a TODO note).
#   --persona      "<text>"      free-text seed for SOUL {{PERSONA}} (default: a TODO note).
#   --with-workflows             also create <slug>_build_idea + <slug>_weekly_review workflow rows.
#   --weekly-cron  "<expr>"      cron for the weekly_review schedule when --with-workflows (default: "30 4 * * 0").
#   --force                      overwrite identity files that already exist.
#   --remint-token               re-mint .api-token even if one is present.
#   --dry-run                    print what would happen; touch nothing.
#   -h | --help
#
# Contract: exits non-zero on a hard failure (bad args, DB unreachable, template
# missing). Token minting + routing are best-effort and warn (not fail) if the
# control-plane API isn't up yet — the verification checklist flags follow-ups.
# ============================================================================
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../shared/lib" && pwd)/agentv-env.sh"

TEMPLATES_DIR="$AGENTV_ROOT/agents/_templates"
SHARED_SKILLS_REL="../../shared/skills"   # symlink target, relative to <dir>/.claude/skills

# ---------------------------------------------------------------------------
# defaults + arg parsing
# ---------------------------------------------------------------------------
SLUG=""; NAME=""; ROLE=""
MODEL="${DEFAULT_AGENT_MODEL:-claude-sonnet-5}"
TMUX=""; INBOX=""; REPORTS_TO="the fleet-manager"; FLEET_MANAGER="fleet-manager"
SERVER_CODE="CP"; PROJECTS=""; PERSONA=""
WITH_WORKFLOWS=0; WEEKLY_CRON="30 4 * * 0"
FORCE=0; REMINT=0; DRY=0

die() { echo "ERR: $*" >&2; exit 1; }
note() { echo "  $*"; }
say()  { echo "▶ $*"; }

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; s/^#//' | sed '$d'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --slug)           SLUG="$2"; shift 2 ;;
    --name)           NAME="$2"; shift 2 ;;
    --role)           ROLE="$2"; shift 2 ;;
    --model)          MODEL="$2"; shift 2 ;;
    --tmux)           TMUX="$2"; shift 2 ;;
    --inbox)          INBOX="$2"; shift 2 ;;
    --reports-to)     REPORTS_TO="$2"; shift 2 ;;
    --fleet-manager)  FLEET_MANAGER="$2"; shift 2 ;;
    --server-code)    SERVER_CODE="$2"; shift 2 ;;
    --projects)       PROJECTS="$2"; shift 2 ;;
    --persona)        PERSONA="$2"; shift 2 ;;
    --with-workflows) WITH_WORKFLOWS=1; shift ;;
    --weekly-cron)    WEEKLY_CRON="$2"; shift 2 ;;
    --force)          FORCE=1; shift ;;
    --remint-token)   REMINT=1; shift ;;
    --dry-run)        DRY=1; shift ;;
    -h|--help)        usage 0 ;;
    *)                die "unknown arg: $1 (try --help)" ;;
  esac
done

[ -n "$SLUG" ] || die "--slug is required"
[ -n "$NAME" ] || die "--name is required"
[ -n "$ROLE" ] || die "--role is required"
echo "$SLUG" | grep -Eq '^[a-z][a-z0-9-]*$' || die "--slug must be lowercase-kebab-case (got '$SLUG')"
[ -d "$TEMPLATES_DIR" ] || die "templates dir missing: $TEMPLATES_DIR"

# derived defaults
[ -n "$TMUX" ]  || TMUX="$SLUG"
[ -n "$INBOX" ] || INBOX="$AGENTS_DIR/$SLUG/notifications/inbox.jsonl"
AGENT_DIR="$AGENTS_DIR/$SLUG"
DISPLAY_NAME="$NAME ($SERVER_CODE)"
[ -n "$PROJECTS" ] || PROJECTS="_TODO: list the project(s) this agent owns — local path, repo, deploy target, gotchas._"
[ -n "$PERSONA" ]  || PERSONA="_TODO: a couple of lines on voice + working style._"

say "Provisioning agent '$SLUG' ($NAME) — model=$MODEL tmux=$TMUX$([ "$DRY" = 1 ] && echo '  [DRY-RUN]')"

# ---------------------------------------------------------------------------
# db helpers (writes surface errors; reads tolerate empty)
# ---------------------------------------------------------------------------
for v in MYSQL_HOST MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE; do
  [ -n "${!v:-}" ] || die "$v not set — fill the repo .env before provisioning"
done
db_exec() { mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -B -e "$1"; }
# Escape a value for use inside a single-quoted SQL literal: backslashes FIRST
# (MySQL treats \ as an escape char by default), then double the single quotes.
sql_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"; }

# connectivity check up-front (clear failure beats a half-provision)
if [ "$DRY" = 0 ]; then
  db_exec "SELECT 1;" >/dev/null 2>&1 || die "cannot reach control-plane DB ($MYSQL_DATABASE@$MYSQL_HOST) — check .env / network"
fi

# ===========================================================================
# 1. agents row (upsert on the unique slug key — idempotent)
# ===========================================================================
say "[1] agents row"
AGENT_ID="$(db_exec "SELECT id FROM agents WHERE slug='$(sql_esc "$SLUG")' LIMIT 1;" 2>/dev/null || true)"
if [ -z "$AGENT_ID" ]; then AGENT_ID="$(uuidgen)"; fi
SQL_AGENT="INSERT INTO agents (id, slug, name, description, model, active, tmux_session, inbox_path)
VALUES ('$AGENT_ID','$(sql_esc "$SLUG")','$(sql_esc "$NAME")','$(sql_esc "$ROLE")','$(sql_esc "$MODEL")',1,'$(sql_esc "$TMUX")','$(sql_esc "$INBOX")')
ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), model=VALUES(model),
  active=1, tmux_session=VALUES(tmux_session), inbox_path=VALUES(inbox_path), updated_at=NOW();"
if [ "$DRY" = 1 ]; then note "would upsert agents row id=$AGENT_ID"; else
  db_exec "$SQL_AGENT"
  AGENT_ID="$(db_exec "SELECT id FROM agents WHERE slug='$(sql_esc "$SLUG")' LIMIT 1;")"
  note "agents row id=$AGENT_ID"
fi

# ===========================================================================
# 2. identity dir from _templates (placeholder substitution)
# ===========================================================================
say "[2] identity dir from templates → $AGENT_DIR"
render() {  # render <template-name>  (writes <AGENT_DIR>/<name> unless present & !force)
  local name="$1" src="$TEMPLATES_DIR/$1" dst="$AGENT_DIR/$1"
  [ -f "$src" ] || die "template missing: $src"
  if [ -f "$dst" ] && [ "$FORCE" = 0 ]; then note "keep   $name (exists — use --force to overwrite)"; return; fi
  if [ "$DRY" = 1 ]; then note "would render $name"; return; fi
  AV_SLUG="$SLUG" AV_NAME="$NAME" AV_ROLE="$ROLE" AV_MODEL="$MODEL" AV_TMUX="$TMUX" \
  AV_REPORTS="$REPORTS_TO" AV_FM="$FLEET_MANAGER" AV_PROJECTS="$PROJECTS" AV_PERSONA="$PERSONA" \
  AV_SERVER="$SERVER_CODE" AV_DISPLAY="$DISPLAY_NAME" SRC="$src" DST="$dst" \
  python3 - <<'PY'
import os
repl = {
  '{{AGENT_SLUG}}':     os.environ['AV_SLUG'],
  '{{AGENT_NAME}}':     os.environ['AV_NAME'],
  '{{ROLE}}':           os.environ['AV_ROLE'],
  '{{MODEL}}':          os.environ['AV_MODEL'],
  '{{TMUX_SESSION}}':   os.environ['AV_TMUX'],
  '{{REPORTING_LINE}}': os.environ['AV_REPORTS'],
  '{{FLEET_MANAGER}}':  os.environ['AV_FM'],
  '{{PROJECTS}}':       os.environ['AV_PROJECTS'],
  '{{PERSONA}}':        os.environ['AV_PERSONA'],
  '{{SERVER_CODE}}':    os.environ['AV_SERVER'],
  '{{DISPLAY_NAME}}':   os.environ['AV_DISPLAY'],
}
with open(os.environ['SRC'], encoding='utf-8') as f: t = f.read()
for k, v in repl.items(): t = t.replace(k, v)
with open(os.environ['DST'], 'w', encoding='utf-8') as f: f.write(t)
PY
  note "wrote  $name"
}
if [ "$DRY" = 0 ]; then mkdir -p "$AGENT_DIR" "$AGENT_DIR/memory" "$AGENT_DIR/notifications/archive"; fi
render CLAUDE.md
render SOUL.md
render MEMORY.md
render PROJECT-MAP.md
# runtime files (gitignored)
if [ "$DRY" = 0 ]; then
  [ -f "$AGENT_DIR/notifications/inbox.jsonl" ] || : > "$AGENT_DIR/notifications/inbox.jsonl"
  note "memory/ + notifications/ ready"
fi

# ===========================================================================
# 3. shared-skills symlink (.claude/skills/shared -> ../../shared/skills)
# ===========================================================================
say "[3] shared-skills symlink"
# Absolute target — robust regardless of nesting depth (a relative target from
# <dir>/.claude/skills must climb 4 levels to the repo root, which is easy to get wrong).
if [ "$DRY" = 1 ]; then note "would link $AGENT_DIR/.claude/skills/shared -> $SHARED_DIR/skills"; else
  mkdir -p "$AGENT_DIR/.claude/skills"
  ln -snf "$SHARED_DIR/skills" "$AGENT_DIR/.claude/skills/shared"
  if [ -e "$AGENT_DIR/.claude/skills/shared/notify/notify.sh" ]; then
    note "symlink OK (resolves to shared/skills)"
  else
    note "WARN: symlink created but shared/skills/notify/notify.sh not found through it — check SHARED_DIR layout"
  fi
fi

# ===========================================================================
# 4. .api-token (mint via the control-plane API — best-effort)
# ===========================================================================
say "[4] .api-token"
TOKEN_FILE="$AGENT_DIR/.api-token"
need_token=1
[ "$DRY" = 1 ] && need_token=0
if [ "$need_token" = 1 ] && [ -s "$TOKEN_FILE" ] && [ "$REMINT" = 0 ]; then
  note "token present ($(wc -c < "$TOKEN_FILE") bytes) — skip (use --remint-token to refresh)"
  need_token=0
fi
if [ "$DRY" = 1 ]; then note "would mint .api-token via $CONTROL_PLANE_API/v1/agents/$SLUG/token"; fi
if [ "$need_token" = 1 ]; then
  if [ -z "${JWT_SECRET:-}" ]; then
    note "WARN: JWT_SECRET unset — cannot mint an operator token. Mint .api-token once the API is configured."
  else
    # Short-lived operator bootstrap token, signed HS256 in pure python (no node dep).
    OP_TOKEN="$(JWT_SECRET="$JWT_SECRET" python3 - <<'PY'
import os, json, time, hmac, hashlib, base64
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=')
h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
now = int(time.time())
p = b64(json.dumps({"sub":"operator","username":"operator","role":"admin","iat":now,"exp":now+300},separators=(',',':')).encode())
msg = h + b'.' + p
sig = b64(hmac.new(os.environ['JWT_SECRET'].encode(), msg, hashlib.sha256).digest())
print((msg + b'.' + sig).decode())
PY
)"
    RESP="$(curl -fsS -X POST "$CONTROL_PLANE_API/v1/agents/$SLUG/token" \
              -H "Authorization: Bearer $OP_TOKEN" -H 'Content-Type: application/json' 2>/dev/null || true)"
    MINTED="$(printf '%s' "$RESP" | python3 -c 'import sys,json;
try: print(json.load(sys.stdin).get("token",""))
except Exception: print("")' 2>/dev/null || true)"
    if [ -n "$MINTED" ]; then
      printf '%s' "$MINTED" > "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE"
      note "minted .api-token via API ($(wc -c < "$TOKEN_FILE") bytes)"
    else
      # API not up (normal during bootstrap) — sign the agent's own long-lived
      # token directly with JWT_SECRET. sub = slug; the API's jwtAuth accepts it.
      AGENT_TOKEN="$(SLUG="$SLUG" JWT_SECRET="$JWT_SECRET" python3 - <<'PY'
import os, json, time, hmac, hashlib, base64
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=')
h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
now = int(time.time())
p = b64(json.dumps({"sub":os.environ['SLUG'],"username":os.environ['SLUG'],"role":"agent","iat":now,"exp":now+10*365*24*3600},separators=(',',':')).encode())
msg = h + b'.' + p
sig = b64(hmac.new(os.environ['JWT_SECRET'].encode(), msg, hashlib.sha256).digest())
print((msg + b'.' + sig).decode())
PY
)"
      if [ -n "$AGENT_TOKEN" ]; then
        printf '%s' "$AGENT_TOKEN" > "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE"
        note "signed .api-token directly via JWT_SECRET ($(wc -c < "$TOKEN_FILE") bytes) — API was not reachable"
      else
        note "WARN: token mint + direct-sign both failed. Re-run with --remint-token."
      fi
    fi
  fi
fi

# ===========================================================================
# 5. notify routing (regenerate routing.conf from the agents table)
# ===========================================================================
say "[5] notify routing"
GEN="$SHARED_DIR/skills/notify/generate-routing-conf.sh"
if [ "$DRY" = 1 ]; then note "would run $GEN"; elif [ -x "$GEN" ]; then
  "$GEN" >/dev/null 2>&1 && note "routing.conf regenerated" || note "WARN: routing regen failed — run $GEN manually"
else
  note "WARN: $GEN not found/executable — cannot regenerate routing"
fi

# ===========================================================================
# 6. workflows (optional: <slug>_build_idea + <slug>_weekly_review)
# ===========================================================================
say "[6] workflows$([ "$WITH_WORKFLOWS" = 0 ] && echo ' (skipped — pass --with-workflows)')"
upsert_workflow() {  # upsert_workflow <slug-suffix> <name> <kind> <builtin_id> <config-json>
  local wslug="${SLUG}_$1" wname="$2" kind="$3" bid="$4" cfg="$5"
  local wid; wid="$(db_exec "SELECT id FROM workflows WHERE agent_id='$AGENT_ID' AND slug='$(sql_esc "$wslug")' LIMIT 1;" 2>/dev/null || true)"
  [ -n "$wid" ] || wid="$(uuidgen)"
  db_exec "INSERT INTO workflows (id, agent_id, slug, name, description, kind, builtin_id, config, active)
    VALUES ('$wid','$AGENT_ID','$(sql_esc "$wslug")','$(sql_esc "$wname")','$(sql_esc "$wname")','$kind','$(sql_esc "$bid")','$(sql_esc "$cfg")',1)
    ON DUPLICATE KEY UPDATE name=VALUES(name), kind=VALUES(kind), builtin_id=VALUES(builtin_id), config=VALUES(config), active=1, updated_at=NOW();"
  echo "$wid"
}
if [ "$WITH_WORKFLOWS" = 1 ]; then
  CFG_JSON="$(printf '{"project_slug":"%s"}' "$SLUG")"
  if [ "$DRY" = 1 ]; then
    note "would upsert workflow ${SLUG}_build_idea (builtin agent_build_idea)"
    note "would upsert workflow ${SLUG}_weekly_review (builtin agent_weekly_review) + schedule '$WEEKLY_CRON'"
  else
    BI_ID="$(upsert_workflow build_idea   "${NAME} — build approved idea"  builtin agent_build_idea    "$CFG_JSON")"
    note "workflow ${SLUG}_build_idea id=$BI_ID"
    WR_ID="$(upsert_workflow weekly_review "${NAME} — weekly self-review"   cron    agent_weekly_review "$CFG_JSON")"
    note "workflow ${SLUG}_weekly_review id=$WR_ID"
    # schedule for the weekly review — set next_fire_at so the scheduler doesn't skip a NULL row.
    # (Prefer the control-plane POST /v1/schedules which computes next_fire_at; fall back to SQL.)
    HAS_SCHED="$(db_exec "SELECT COUNT(*) FROM schedules WHERE workflow_id='$WR_ID';" 2>/dev/null || echo 0)"
    if [ "${HAS_SCHED:-0}" = "0" ]; then
      SCHED_ID="$(uuidgen)"
      # next Sunday 04:30 UTC (matches the default cron); adjust if you change --weekly-cron.
      db_exec "INSERT INTO schedules (id, workflow_id, cron_expr, enabled, next_fire_at, created_at)
        VALUES ('$SCHED_ID','$WR_ID','$(sql_esc "$WEEKLY_CRON")',1,
          DATE_ADD(DATE_ADD(CURDATE(), INTERVAL (7 - WEEKDAY(CURDATE()) + 6) % 7 DAY), INTERVAL 4 HOUR) + INTERVAL 30 MINUTE,
          NOW());"
      note "schedule created (cron '$WEEKLY_CRON', next_fire_at set non-NULL)"
      note "TIP: if you changed --weekly-cron, recreate via the API (POST /v1/schedules) so next_fire_at matches."
    else
      note "schedule already exists for ${SLUG}_weekly_review — left as-is"
    fi
  fi
fi

# ===========================================================================
# 7. verification checklist
# ===========================================================================
cat <<EOF

────────────────────────────────────────────────────────────────────────────
✔ Provisioning pass complete for '$SLUG'$([ "$DRY" = 1 ] && echo '  [DRY-RUN — nothing written]')

Verify before calling it done (these are the silent-failure traps):

  1. agents row present + active:
       mysql … -e "SELECT slug,name,model,tmux_session FROM agents WHERE slug='$SLUG';"
  2. identity files rendered (no stray {{PLACEHOLDERS}}):
       grep -RIl '{{' "$AGENT_DIR"   # should print nothing
  3. shared symlink resolves (else scheduled skills fail 'run_script_not_found'):
       ls "$AGENT_DIR/.claude/skills/shared/weekly-review/run.sh"
  4. .api-token present + plausible (~250-260 bytes; weekly-review/submit-idea need it):
       wc -c < "$TOKEN_FILE"
  5. notify routing knows the agent:
       grep -E '^$SLUG\b' "$SHARED_DIR/skills/notify/routing.conf"
  6. round-trip notify lands in the inbox:
       "$SHARED_DIR/skills/notify/notify.sh" --to $SLUG --from $FLEET_MANAGER "provisioning smoke-check"
$([ "$WITH_WORKFLOWS" = 1 ] && cat <<WF
  7. workflows + non-NULL schedule (a NULL next_fire_at never fires):
       mysql … -e "SELECT w.slug, s.cron_expr, s.next_fire_at FROM workflows w LEFT JOIN schedules s ON s.workflow_id=w.id WHERE w.agent_id='$AGENT_ID';"
WF
)
Then launch the session (model + display name from the DB row):
       tmux new-session -d -s $TMUX -c "$AGENT_DIR"
       tmux send-keys -t $TMUX 'claude --permission-mode auto --model $MODEL --remote-control "$DISPLAY_NAME"' Enter
────────────────────────────────────────────────────────────────────────────
EOF
