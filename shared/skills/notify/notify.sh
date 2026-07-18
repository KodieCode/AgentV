#!/usr/bin/env bash
# notify.sh — cross-agent messaging. Writes to the target's inbox + the shared
# team_activity log + (optionally) tmux-wakes them. Routing via routing.conf
# (DB-generated). Paths come from .env via agentv-env.sh.
#
# Usage: notify.sh --to <slug> [--wake] [--from <slug>] "<message>"
set -e
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

TO=""; WAKE=0; FROM=""; BODY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --to)   TO="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    --wake) WAKE=1; shift ;;
    --)     shift; BODY="$*"; break ;;
    *)      if [ -z "$BODY" ]; then BODY="$1"; else BODY="$BODY $1"; fi; shift ;;
  esac
done
[ -n "$TO" ] && [ -n "$BODY" ] || { echo "usage: notify.sh --to <slug> [--wake] [--from <slug>] \"<message>\"" >&2; exit 2; }

# Sender — default to AGENT_SLUG_OVERRIDE or the cwd basename.
[ -z "$FROM" ] && FROM="${AGENT_SLUG_OVERRIDE:-$(basename "$PWD")}"

ROUTING_CONF="$(dirname "${BASH_SOURCE[0]}")/routing.conf"
[ -f "$ROUTING_CONF" ] || { echo "ERR: routing.conf missing — run generate-routing-conf.sh" >&2; exit 1; }
INBOX=$(awk -v s="$TO" '!/^#/ && NF>=2 && $1==s {print $2}' "$ROUTING_CONF")
SESSION=$(awk -v s="$TO" '!/^#/ && NF>=3 && $1==s {print $3}' "$ROUTING_CONF")
[ -n "$INBOX" ] && [ -n "$SESSION" ] || { echo "ERR: unknown target '$TO' — not in routing.conf (regenerate after adding the agent)" >&2; exit 1; }

mkdir -p "$(dirname "$INBOX")"
TS=$(date -u -Iseconds)

# Dedup: skip identical (from+body) within 120s — stops repeated identical wakes.
if [ -f "$INBOX" ]; then
  DEDUP=$(FROM_UPPER="${FROM^^}" BODY="$BODY" INBOX="$INBOX" python3 - <<'PY'
import json, os, sys
from datetime import datetime, timezone, timedelta
try:
    with open(os.environ['INBOX'], 'rb') as f:
        try: f.seek(-4096, 2)
        except OSError: f.seek(0)
        last = f.read().splitlines()
    entry = json.loads(last[-1].decode('utf-8')) if last else {}
except Exception:
    sys.exit(0)
if entry.get('from') == os.environ['FROM_UPPER'] and entry.get('body') == os.environ['BODY']:
    try:
        ts = datetime.fromisoformat(entry['ts'].replace('Z','+00:00'))
        if datetime.now(timezone.utc) - ts < timedelta(seconds=120): print("dup")
    except Exception: pass
PY
)
  [ "$DEDUP" = "dup" ] && { echo "  deduped: identical [$FROM → $TO] within 120s — skipped"; exit 0; }
fi

# Append to target inbox
python3 -c "import json,sys; print(json.dumps({'ts':sys.argv[1],'from':sys.argv[2].upper(),'category':sys.argv[2].upper(),'body':sys.argv[3]}))" \
  "$TS" "$FROM" "$BODY" >> "$INBOX"

# Append to shared team_activity log (fleet-manager reads for the digest)
mkdir -p "$(dirname "$TEAM_ACTIVITY")"
python3 -c "import json,sys; print(json.dumps({'ts':sys.argv[1],'from':sys.argv[2],'to':sys.argv[3],'body':sys.argv[4],'waked':bool(int(sys.argv[5]))}))" \
  "$TS" "$FROM" "$TO" "$BODY" "$WAKE" >> "$TEAM_ACTIVITY"

echo "  queued: [$FROM → $TO] $BODY"

# Optionally wake the target
if [ "$WAKE" = "1" ]; then
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    WAKE_MSG="New entry in your inbox — read notifications/inbox.jsonl and action it."
    # opencode's TUI submits on a SINGLE Enter; the double-Enter below (needed by
    # Claude, whose first Enter only stages) garbles it. Detect opencode agents
    # by their opencode.jsonc (agent dir = inbox's grandparent).
    if [ -f "$(dirname "$(dirname "$INBOX")")/opencode.jsonc" ]; then
      tmux send-keys -t "$SESSION" "$WAKE_MSG" Enter
    else
      tmux send-keys -t "$SESSION" "$WAKE_MSG" Enter
      sleep 1
      tmux send-keys -t "$SESSION" Enter
    fi
    echo "  woke: $SESSION"
    # Claim the watchdog marker so the 5-min watchdog doesn't re-fire this same
    # delivered wake (it only wakes when inbox is newer than marker). Watchdog
    # stays the net for genuinely MISSED wakes (session down → marker left stale).
    # Claim the watchdog marker with the CONTENT hash we just delivered (the
    # watchdog gates re-wakes on content, not mtime), so it doesn't double-wake.
    md5sum "$INBOX" 2>/dev/null | cut -d' ' -f1 > "${INBOX%.jsonl}.watchdog-marker" 2>/dev/null || true
  else
    echo "  (session '$SESSION' not running — wake skipped)"
  fi
fi
