# Changelog

AgentV follows a simple rule for anyone who has cloned it: **`git pull` then
`bash setup/update.sh`**. The updater migrates the schema, applies capability
rollouts, and restarts the control-plane **without touching running agents**.

## 0.3.0 — 2026-07-14

### Added
- **Update notifications (`version-check` skill)** — because every install is a
  git clone, a nightly cron fetches the tracked branch and compares local
  `VERSION`/`HEAD` against origin. Result is written to `agentv_meta`
  (migration 006) and surfaced two ways: a dismissible **dashboard banner**
  (`GET /v1/version`) and a **non-waking fleet-manager notification** when
  behind. Notify-only — it never runs the update. Fails safe on
  offline/detached-HEAD/no-remote (records a reason, reports 0 behind).

## 0.2.0 — 2026-07-14

### Added
- **In-place updater (`setup/update.sh`)** — upgrade an existing install
  without knocking out running agent sessions. Fast-forward pull → deps →
  schema migrate → capability upgrade-steps → routing → crons → app rebuild →
  control-plane restart only. Reports which agents predate the update so you
  can rotate them at your convenience.
- **Capability upgrade-steps (`setup/run-upgrade-steps.sh` + `setup/upgrade-steps/`)**
  — idempotent, ledgered rollouts for changes a code pull alone can't deliver
  (new-skill initialisation, backfills, one-time setup). Future rollouts are
  just a new numbered step.
- **Multi-provider agents (migration `005_agents_runtime`)** — `provider`,
  `runner`, `capability_profile`, `credential_profile`, `runtime_config` on
  `agents`. `new-agent.sh --provider anthropic|openai|google` auto-derives the
  runner (`claude-code` / `codex-cli` / `gemini-cli`). Existing rows default to
  anthropic/claude-code, so an upgraded fleet launches exactly as before.
- **Runner-aware launch dispatch (`agentv_launch_cmd`)** — one source of truth
  for the session-start command, branching on `runner`. A codex/gemini agent is
  never silently relaunched as Claude Code.
- **`memory-search` skill (FTS5)** — full-text recall over an agent's memory +
  identity files. Rolled out to existing installs by upgrade-step
  `001_memory_search_fts5`; reindex step added to `agent-wrap-up`.

### Notes
- Migrations are additive by policy — a column a running agent's launcher reads
  is never dropped or renamed.
- Safety nets (heartbeat / watchdog / pane-snapshot) remain single-host
  (this box's `FLEET_HOST`); off-box agents are provisioned but monitored on
  their own host.

## 0.1.0 — 2026-07-03

Initial pull-and-go fleet-replication release: control-plane (API + dashboard),
DB-driven roster, host-aware ops (`agents.host` / `FLEET_HOST`), provisioning
(`new-agent.sh`), safety-net crons, security-hardened auth (role separation,
injection fixes, stranded-run reaper).
