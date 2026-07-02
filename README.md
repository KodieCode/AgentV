# AgentV

A pull-and-go framework for standing up an **agentic development + operations fleet** on a fresh server. It's a generalised extraction of a production fleet: long-lived Claude Code agent sessions (one per "team member"), coordinated through a shared notification layer and a web control-plane dashboard, backed by MySQL.

Clone it onto a server, run the guided setup, and you have a working fleet with a control-plane database, the dashboard, shared agent infrastructure, and a fleet-manager agent that provisions the rest of the team itself.

## What you get

- **Control-plane schema** (MySQL) — agents, ideas, workflows, schedules, runs, projects… (versioned migrations, rebuilt anywhere)
- **Dashboard** — agent roster + live pulse, per-agent terminal, ideas kanban, scheduler, asset surfaces
- **Shared agent layer** — notify/routing, reusable skills (wrap-up, weekly-review, build-idea, daily-digest), safety-net crons, a shared knowledge corpus
- **One starter agent** — the fleet-manager (operator-named), provisioned from a template; it creates all further agents itself via `provisioning/new-agent.sh`
- **Per-project app boilerplate** — Vite/React + Express + MySQL + JWT
- **Scripted provisioning** — add new agents without hand-wiring

## Quickstart

```bash
git clone git@github.com:KodieCode/AgentV.git
cd AgentV
./setup/configure.sh      # guided wizard: prompts, auto-gens JWT, tests the DB, writes .env, runs preflight, offers to bootstrap
```

`configure.sh` runs **preflight** first — it checks every system prerequisite (node, pm2, nginx, certbot, tmux, mysql, git, gh, jq, and that the Claude CLI is installed **and logged in**), confirms it can reach your MySQL, and only then proceeds. Missing tools? Run `./setup/install-deps.sh` on a bare server.

Manual path (skip the wizard): `cp .env.example .env`, edit it, then `./setup/bootstrap.sh`.

See **ONBOARDING.md** for the full step-by-step (system prerequisites, DNS/SSL, and how to reach the fleet-manager once it's up).

## Status

Built in phases. See ONBOARDING.md for what's live vs pending.
