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
cp .env.example .env
# Fill .env: MYSQL_*, JWT_SECRET (openssl rand -hex 48), APP_DOMAIN_BASE,
# DASHBOARD_DOMAIN, OPENROUTER_API_KEY, GITHUB_ORG, MAIL_*, ADMIN_NOTIFY_TO
```

## 2. Bootstrap

```bash
./setup/bootstrap.sh
```

Runs, in order:
1. **preflight** — verifies the system prerequisites + a reachable DB
2. **install** — `npm install` for the control-plane (and per-package deps)
3. **migrate** — builds the control-plane schema in your MySQL (`knex migrate:latest`)
4. **seed** — creates the two starter agents (fleet-manager, finance-builder)  _(phase D)_
5. **provision** — wires nginx + certbot for the dashboard, pm2 entries, agent tmux sessions  _(phase C/D)_
6. **start** — launches the dashboard + agent sessions

## 3. Verify

- Dashboard reachable at `https://$DASHBOARD_DOMAIN`
- Two agents show as `idle` in the roster
- A test notification routes between agents

## Build status (phased)

- [x] **A — Scaffold + control-plane schema** (migrations, knexfile, env, bootstrap skeleton)
- [x] **B — Shared layer** (reports sink + DB-driven roster; notify/routing; safety nets: watchdog/heartbeat/snapshot/nightly-wrap-up; generic skills: agent-wrap-up/weekly-review/build-idea/submit-idea/verify-done; fleet-manager skills: daily-digest→reports/team-review/skill-watch/auto-pr-review)
- [ ] **C — Control-plane dashboard** (api + app, generalised)
- [ ] **D — Agent templates + 2 starter agents + scripted provisioning**
- [ ] **E — Onboarding polish + dry-run a fresh install**
