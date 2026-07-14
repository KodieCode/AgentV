---
name: version-check
description: >
  Check whether a newer AgentV is available on the branch this install tracks,
  and record it for the dashboard update banner + a nightly fleet-manager
  notification. Notify-only — never runs the update. Run on a nightly cron
  (installed by setup/install-crons.sh) or by hand: shared/skills/version-check/check.sh
---

# version-check

Because every AgentV install is a git clone, "is there a new version?" is just
`git fetch` the tracked branch + compare local `HEAD`/`VERSION` against origin.

`check.sh`:
1. Resolves the tracked branch, fetches it from `origin` (fails safe on offline
   / detached HEAD / no remote — records a reason, reports 0 behind).
2. Compares local `VERSION` + commit count against `origin/<branch>`.
3. Upserts the result into `agentv_meta` (`version_current`, `version_latest`,
   `version_branch`, `version_behind`, `version_checked_at`, `version_error`).
4. If behind, notifies the fleet-manager (no `--wake` — never urgent).
   Suppress the notify with `VERSION_CHECK_NOTIFY=0` (dashboard banner only).

The dashboard reads `agentv_meta` via `GET /v1/version` and shows a banner when
`version_behind > 0`. The operator updates when they choose:

```bash
git pull && bash setup/update.sh
```

Installed as a nightly cron by `setup/install-crons.sh`. Runs against the tracked
branch — "behind" means "behind what `setup/update.sh` would pull".
