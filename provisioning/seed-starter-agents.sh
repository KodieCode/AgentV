#!/usr/bin/env bash
# seed-starter-agents — provision the two starter agents (fleet-manager +
# finance-builder) by calling new-agent.sh with the right flags. Their identity
# dirs already ship in the repo, so new-agent.sh keeps them (render skips
# existing files) and just registers the DB row, token, symlink, routing, and
# (with --with-workflows) the per-agent build/review workflows.
# Idempotent. Extra args pass through (e.g. --dry-run).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$HERE/new-agent.sh" \
  --slug fleet-manager --name "Fleet Manager" \
  --role "Coordinates the fleet: dispatches work to other agents, owns infra/deploys, maintains the project registry + control plane, and provisions new agents as the team grows." \
  --with-workflows "$@"

"$HERE/new-agent.sh" \
  --slug finance-builder --name "Finance Builder" \
  --role "Builds finance automations + dashboards against the company's accounting stack (ingest → transform → dashboard); owns the finance project end-to-end." \
  --with-workflows "$@"

echo "✔ starter agents seeded (fleet-manager, finance-builder)"
