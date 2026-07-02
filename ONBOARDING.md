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
6. **provision** — wires nginx + certbot for the dashboard, pm2 entries
7. **build** — builds the dashboard SPA (`VITE_API_URL` baked to your domain)
8. **start** — launches the dashboard + agent sessions

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

> Prereq for remote-control + agent sessions: `claude` must be logged in on the server
> (one-time). If a session shows "Not logged in", attach once and run `/login`; restarts
> then auto-register.

## Build status (phased)

- [x] **A — Scaffold + control-plane schema** (migrations, knexfile, env, bootstrap skeleton)
- [x] **B — Shared layer** (reports sink + DB-driven roster; notify/routing; safety nets: watchdog/heartbeat/snapshot/nightly-wrap-up; generic skills: agent-wrap-up/weekly-review/build-idea/submit-idea/verify-done; fleet-manager skills: daily-digest→reports/team-review/skill-watch/auto-pr-review)
- [x] **C — Control-plane dashboard** (api + app, generalised). Verified on the dev box: API boots, `/healthz` green, DB up, scheduler runs, agent-token auth works (`/v1/ideas`, `/v1/agents`, `/v1/reports`); app builds clean (`vite build`).
- [x] **D — Agent template + fleet-manager + scripted provisioning**. The fleet-manager is the ONLY starter agent; it creates the rest via `new-agent.sh`. Its name/slug are operator-chosen (wizard) and rendered from `agents/_templates/fleet-manager/`. Verified end-to-end (e.g. as "Norman"): DB row, rendered identity (no stray placeholders), symlink resolves, `.api-token` signed + authenticates, notify routing + round-trip, workflows + non-NULL schedules.
- [x] **E — Bootstrap wired + validated end-to-end**, including a full real run on a server with a live domain: preflight → install → migrate → seed fleet-manager → seed admin → provision (nginx + certbot SSL) → build → start. Dashboard came up on HTTPS with a valid cert, the fleet-manager launched authenticated, and it provisioned a sub-agent that built a live site — proving the self-expanding flow. That run shook out (and fixed) the last real bugs: devDeps skipped under `NODE_ENV=production`, the folder-trust prompt hanging agent launch, a missing dashboard-admin seed, and new agents launching in bypass instead of auto mode.
