# Changelog

AgentV follows a simple rule for anyone who has cloned it: **`git pull` then
`bash setup/update.sh`**. The updater migrates the schema, applies capability
rollouts, and restarts the control-plane **without touching running agents**.

## 0.6.0 — 2026-07-23

### Added
- **`--credential-profile <ref>`** — stores a runtime credential pointer on the
  agents row (e.g. `env-file:/secure/<provider>.env`); NULL = ambient login.
  Ports the live-fleet provisioning flag; the column already existed (005) but
  the provisioner never populated it.
- **`--provider-env <path>`** — symlinks an operator-supplied env file to the
  agent dir as `.env.provider` (validated to exist, gitignored). `setup/start.sh`
  already sources it before launching the interactive session — this wires the
  provisioning end so a per-agent provider key can be supplied at create time.

### Fixed
- **`agents.credential_profile` widened varchar(64) → varchar(255)** (migration
  007). A credential pointer is an absolute path (`env-file:/secure/…`) that
  overran 64 chars and was silently truncated by MySQL, leaving the launcher to
  resolve a chopped path. Matches the live-fleet fix.
- **`.gitignore` now covers `**/.env.*`** — previously `.env.provider` was not
  matched by `**/.env` and could have been committed.

## 0.5.0 — 2026-07-18

### Added
- **Cross-host notify** — agents on another box (`agents.host` != this
  `FLEET_HOST`) now receive messages + wakes. routing.conf carries a `host`
  column; for an off-box target, notify SSHes to that host to append the inbox
  + tmux-wake the session, using an ssh alias + remote tmux path from
  `remote-hosts.conf`. Single-box fleets are unaffected (nothing to configure).
  Makes multi-host fleets truly two-way — the payoff of the `FLEET_HOST` model.

## 0.4.2 — 2026-07-18

### Fixed
- **Watchdog re-wake gate now keys on inbox CONTENT, not mtime** (ported from
  the live fleet). inbox mtime gets bumped by fs ops even when content is
  unchanged, which repeat-woke idle agents; the marker now stores a content
  hash and re-wakes only when the content changes. notify.sh claims the marker
  with the same hash.

## 0.4.1 — 2026-07-18

### Fixed
- **opencode wake** — notify.sh + inbox-watchdog now send a single Enter to
  opencode agents (detected by `opencode.jsonc`). opencode's TUI submits on one
  Enter; the Claude double-Enter garbled it, so wakes never delivered.
- **Nightly wrap-up loop** — the activity gate excluded an agent's own
  `Wrap-up: …` message, so an idle agent no longer wraps up forever off its own
  previous wrap-up notification.

## 0.4.0 — 2026-07-17

### Added
- **opencode runner (`opencode-cli`, provider `openrouter`)** — a fourth runner
  so fleet agents can run on any OpenRouter-accessible model (deepseek, qwen,
  llama, grok, kimi, gpt…). `new-agent.sh --provider openrouter` derives it;
  `agentv_launch_cmd` launches the opencode TUI (model + auto-approve from the
  agent's `opencode.jsonc`, OpenRouter creds from opencode's `auth.json`). Model
  is stored as the opencode `provider/model` string, e.g.
  `openrouter/deepseek/deepseek-chat`. Verified end-to-end on the live fleet
  (real OpenRouter call through the control-plane runtime).

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
