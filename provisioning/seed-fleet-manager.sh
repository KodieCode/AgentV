#!/usr/bin/env bash
# seed-fleet-manager — provision the single starter agent (the fleet-manager),
# named whatever the operator chose at onboarding (FLEET_MANAGER_NAME / _SLUG).
# Renders the rich fleet-manager identity from agents/_templates/fleet-manager/
# with the chosen name+slug, then registers it via new-agent.sh (DB row, token,
# symlink, routing, workflows). Everything else is created LATER by this agent.
# Idempotent (keeps existing rendered files); extra args pass through.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../shared/lib/agentv-env.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SLUG="${FLEET_MANAGER_SLUG:-fleet-manager}"
NAME="${FLEET_MANAGER_NAME:-Fleet Manager}"
TPL="$AGENTV_ROOT/agents/_templates/fleet-manager"
DEST="$AGENTS_DIR/$SLUG"

echo "── rendering fleet-manager identity → $DEST  (name='$NAME' slug='$SLUG')"
mkdir -p "$DEST/memory" "$DEST/notifications/archive"
for f in CLAUDE.md SOUL.md MEMORY.md PROJECT-MAP.md; do
  if [ -f "$DEST/$f" ]; then
    echo "  keep $f (exists)"
  else
    sed "s|{{FLEET_MANAGER_NAME}}|$NAME|g; s|{{FLEET_MANAGER_SLUG}}|$SLUG|g" "$TPL/$f" > "$DEST/$f"
    echo "  render $f"
  fi
done

# Register (new-agent.sh render() keeps the files above; does DB row + token +
# shared symlink + notify routing + per-agent workflows).
"$HERE/new-agent.sh" \
  --slug "$SLUG" --name "$NAME" \
  --role "Coordinates the fleet: dispatches work, owns infra/deploys, maintains the project registry + control plane, and PROVISIONS NEW AGENTS (via new-agent.sh) as the team grows." \
  --with-workflows "$@"

echo "✔ fleet-manager '$NAME' ($SLUG) seeded. It creates further agents via provisioning/new-agent.sh."
