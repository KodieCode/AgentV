# AgentV — Onboarding

How to stand up the fleet on a fresh server.

## 0. Prerequisites (system)

Ubuntu 24.04 LTS (or similar). Install the stack — or run `./setup/install-deps.sh` on a bare server:

| Tool | Version | Role |
|---|---|---|
| Node.js (via nvm) | 22.x LTS | Runtime for dashboard + apps |
| pm2 | 6.x | Process manager (survives reboot: `pm2 startup` + `pm2 save`) |
| nginx | current | Reverse proxy + static + TLS |
| certbot | 2.x | Let's Encrypt SSL (nginx plugin) |
| tmux | current | Hosts the long-lived agent sessions |
| MySQL client | 8.x | DB access |
| git, gh | current | Repos + PRs (run `gh auth login`) |
| jq | 1.7 | Shell JSON |
| Claude Code CLI | 2.1.x | The agent runtime (log in once) |

Also needed before bootstrap:
- A **MySQL 8** instance (managed or local) — host/user/pass for `.env`
- A **domain** with wildcard DNS `*.<domain>` → this server, and an A record for the dashboard
- An **outbound email relay** account (Brevo/SendGrid/SES) — cloud IPs are blocklisted
- An **Anthropic** account (Claude Code) and optionally an **OpenRouter** key

## 1. Clone + configure

```bash
git clone git@github.com:KodieCode/AgentV.git
cd AgentV
./setup/configure.sh        # guided wizard — prompts, auto-gens JWT, tests DB, writes .env, preflight
```
The wizard offers to run bootstrap at the end. (Manual path: `cp .env.example .env` and edit by hand, then run bootstrap yourself.)

**Two one-time logins the wizard can't do for you** (OAuth — run once on the box):
```bash
gh auth login      # GitHub, for PRs
claude             # Claude Code, log in once
```
If you set a `DASHBOARD_DOMAIN`, point its DNS at this server before bootstrap so certbot can issue SSL.

## 2. Bootstrap

```bash
./setup/bootstrap.sh        # (the wizard offers to run this for you)
```

Runs, in order:
1. **preflight** — verifies the system prerequisites + a reachable DB
2. **install** — `npm install` for the control-plane (and per-package deps)
3. **migrate** — builds the control-plane schema in your MySQL (`knex migrate:latest`)
4. **seed fleet-manager** — creates the single starter agent (named whatever you chose in the wizard). It provisions all other agents itself, later.
5. **seed admin** — creates the dashboard login from `ADMIN_USERNAME`/`ADMIN_PASSWORD`. If you left the password blank, a strong one is generated and **printed once** in the bootstrap output — save it.
6. **install safety-net crons** — user-crontab entries for the inbox-watchdog (every 5 min), pane-snapshot (every 10 min), nightly-wrap-up (03:00) and heartbeat (hourly). Idempotent — re-runs never duplicate entries. Skip with `SKIP_CRON_INSTALL=1` if you schedule these yourself (e.g. systemd timers).
7. **provision** — wires nginx + certbot for the dashboard, pm2 entries
8. **build** — builds the dashboard SPA (`VITE_API_URL` baked to your domain)
9. **start** — launches the dashboard + agent sessions

## 3. Verify

- Dashboard reachable at `https://$DASHBOARD_DOMAIN` (or `http://localhost:$DASHBOARD_APP_PORT` locally)
- Sign in with `ADMIN_USERNAME` + the password (from the wizard, or the one printed at bootstrap step 5)
- The fleet-manager shows as `idle` in the roster
- `GET /healthz` returns `{"ok":true,"db":"up"}`

## 4. Using the fleet

Bootstrap already **started** the fleet-manager — it's a long-lived `tmux` session
running `claude --remote-control "<your name>"`. You don't start it; you reach it,
three ways:

1. **Dashboard (primary):** open the dashboard → roster → click the fleet-manager →
   **Terminal** tab. That's a live websocket into its session — type to it in the browser.
   The dashboard also has the **Ideas** kanban and **Briefings** (digests/reviews) views.
2. **Claude Desktop / mobile:** because it launched with `--remote-control`, it appears
   in the Claude app's session picker (requires `claude` logged in on the box). Attach + chat from anywhere.
3. **SSH + tmux:** `ssh <server>` then `tmux attach -t <slug>`.

**Day one:** open the fleet-manager and tell it what you want to build. It dispatches,
and **provisions new agents itself** via `provisioning/new-agent.sh` as the work grows —
you don't hand-create them.

> Prereq for remote-control + agent sessions: the runner CLI must be logged in on the
> server (one-time). For Claude-Code agents that's `claude` — if a session shows "Not
> logged in", attach once and run `/login`; restarts then auto-register. Codex/Gemini
> agents need their own CLI authenticated (see §5).

## 5. Running non-Claude agents

An agent's **runner** is the CLI that drives its session. AgentV ships three:

| `--provider` | runner | CLI it launches |
|---|---|---|
| `anthropic` (default) | `claude-code` | `claude --permission-mode auto --model <model> --remote-control` |
| `openai` | `codex-cli` | `codex --model <model> --sandbox <capability> --cd <dir>` |
| `google` | `gemini-cli` | `gemini --approval-mode yolo --skip-trust` |

```bash
# a Codex agent (runner auto-derived from provider)
provisioning/new-agent.sh --slug roger --name Roger --role "…" --provider openai --model gpt-5-codex

# override the derived runner / sandbox explicitly if you need to
provisioning/new-agent.sh --slug gem --name Gem --role "…" --provider google --runner gemini-cli
```

The launch command is resolved centrally (`agentv_launch_cmd`), so session start,
rotation, and revive all agree — a Codex/Gemini agent is never relaunched as Claude.

**Prereqs per runner:** each runner's CLI must be installed + authenticated on the box
(`codex` reads its model from `~/.codex/config.toml`; a Gemini agent sources
`<agent-dir>/.env.provider` for credentials before launch). Existing agents and any
`--provider`-less provisioning stay pure Claude Code — nothing changes until you opt in.

## 6. Updating an existing install

Already running a fleet? Pull the newer AgentV and run the updater — it upgrades the
system **without knocking out running agents**:

```bash
cd <agentv-repo> && git pull && bash setup/update.sh
```

`update.sh`: fast-forward pull → dependency install → schema migrate → **capability
upgrade-steps** → routing regen → safety-net crons → dashboard rebuild → restart the
**control-plane pm2 procs only**. Your agent tmux sessions are never touched; the script
lists which agents predate the update so you can rotate them at your convenience (updated
skill files apply on next use; CLAUDE.md/doctrine changes need a rotate).

**Capability rollouts.** Some upgrades need more than new code on disk — a new skill may
need a one-time index built, a backfill run, a cron added. Those ship as idempotent,
ledgered steps in `setup/upgrade-steps/` (e.g. the memory-search FTS5 rollout). The
updater applies any not-yet-applied step and records it, so re-running is safe and each
step pays its cost once. Migrations are additive by policy — a column a running agent's
launcher reads is never dropped or renamed, so a mid-upgrade agent keeps working.

> Guard: `update.sh` refuses to pull over uncommitted changes to tracked files (it won't
> silently discard your edits) and does a fast-forward-only merge (it stops on divergence
> for you to resolve). `.env`, `data/`, and `dist/` are untracked and left alone.

## Security model

Two token roles, both HS256 JWTs signed with `JWT_SECRET`:

| | **admin** (operator) | **agent** |
|---|---|---|
| Issued by | Dashboard login (`POST /v1/auth/login`); short-lived bootstrap token signed by `new-agent.sh` | `POST /v1/agents/:slug/token` (admin-only) or direct-signed by `new-agent.sh` during bootstrap; stored in each agent's `.api-token` |
| Lifetime | `JWT_EXPIRES_IN` (default 7d) | 1y |
| Can | Everything | All GET routes; `POST /v1/ideas` (submit ideas); idea status transitions that aren't operator decisions |
| Cannot | — | Mint tokens; create/modify/delete agents, workflows, schedules; fire workflow runs; approve ideas or flip them to done (approval fires the auto-build, done triggers the server-side `gh pr merge` — both are **human** decisions); attach to agent terminals; broadcast wrap-up |

Notes:

- **Legacy tokens** (issued before roles existed) carry no `role` claim and are
  treated as **agent** (least privilege). After upgrading: operators just sign in
  to the dashboard again; agent `.api-token` files keep working. If an agent
  token was minted pre-upgrade with the old `sub: agent:<slug>` form it still
  authenticates — re-mint with `new-agent.sh --remint-token` if you want the
  canonical claims.
- The build lifecycle doesn't need agent write access: `agent_build_idea` runs
  server-side and updates ideas via direct DB writes.
- The terminal WebSocket and SSE run-stream accept the JWT as a `?token=` query
  parameter (browsers can't set headers there). Keep the dashboard on TLS and
  treat access logs as sensitive. Terminal attach is admin-only and logged
  (slug + token sub + timestamp).
- Agent `slug` and `tmux_session` are format-validated (`^[a-z][a-z0-9_-]{0,63}$`)
  at the API and in `new-agent.sh`; everything that reaches a subprocess goes
  through exec-with-args, never a shell string.
- Cron-driven skills run `claude` with `--permission-mode auto` (destructive git
  operations blocked), not `--dangerously-skip-permissions`.

## Build status (phased)

- [x] **A — Scaffold + control-plane schema** (migrations, knexfile, env, bootstrap skeleton)
- [x] **B — Shared layer** (reports sink + DB-driven roster; notify/routing; safety nets: watchdog/heartbeat/snapshot/nightly-wrap-up; generic skills: agent-wrap-up/weekly-review/build-idea/submit-idea/verify-done; fleet-manager skills: daily-digest→reports/team-review/skill-watch/auto-pr-review)
- [x] **C — Control-plane dashboard** (api + app, generalised). Verified on the dev box: API boots, `/healthz` green, DB up, scheduler runs, agent-token auth works (`/v1/ideas`, `/v1/agents`, `/v1/reports`); app builds clean (`vite build`).
- [x] **D — Agent template + fleet-manager + scripted provisioning**. The fleet-manager is the ONLY starter agent; it creates the rest via `new-agent.sh`. Its name/slug are operator-chosen (wizard) and rendered from `agents/_templates/fleet-manager/`. Verified end-to-end (e.g. as "Norman"): DB row, rendered identity (no stray placeholders), symlink resolves, `.api-token` signed + authenticates, notify routing + round-trip, workflows + non-NULL schedules.
- [x] **E — Bootstrap wired + validated end-to-end**, including a full real run on a server with a live domain: preflight → install → migrate → seed fleet-manager → seed admin → provision (nginx + certbot SSL) → build → start. Dashboard came up on HTTPS with a valid cert, the fleet-manager launched authenticated, and it provisioned a sub-agent that built a live site — proving the self-expanding flow. That run shook out (and fixed) the last real bugs: devDeps skipped under `NODE_ENV=production`, the folder-trust prompt hanging agent launch, a missing dashboard-admin seed, and new agents launching in bypass instead of auto mode.
- [x] **F — In-place updater + multi-provider runtime** (0.2.0). `setup/update.sh` upgrades an existing install without disturbing running agents; capability rollouts ship as idempotent `setup/upgrade-steps/`. Migration 005 adds the agent runtime descriptor (provider/runner/capability); `new-agent.sh --provider` provisions Claude-Code / Codex / Gemini agents, dispatched centrally by `agentv_launch_cmd`. First capability step rolls out the memory-search FTS5 skill. Tested on a throwaway install; adversarial safety review passed (updater never touches agent sessions; migrations additive).
