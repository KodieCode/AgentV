# AgentV

A pull-and-go framework for standing up an **agentic development + operations fleet** on a fresh server. It's a generalised extraction of a production fleet: long-lived Claude Code agent sessions (one per "team member"), coordinated through a shared notification layer and a web control-plane dashboard, backed by MySQL.

Clone it onto a server, fill one `.env`, run `bootstrap.sh`, and you have a working fleet with a control-plane database, the dashboard, shared agent infrastructure, and two starter agents.

## What you get

- **Control-plane schema** (MySQL) — agents, ideas, workflows, schedules, runs, projects… (versioned migrations, rebuilt anywhere)
- **Dashboard** — agent roster + live pulse, per-agent terminal, ideas kanban, scheduler, asset surfaces
- **Shared agent layer** — notify/routing, reusable skills (wrap-up, weekly-review, build-idea, daily-digest), safety-net crons, a shared knowledge corpus
- **Two starter agents** — a fleet-manager and a finance-automation builder — provisioned from templates
- **Per-project app boilerplate** — Vite/React + Express + MySQL + JWT
- **Scripted provisioning** — add new agents without hand-wiring

## Quickstart

```bash
git clone git@github.com:KodieCode/AgentV.git
cd AgentV
cp .env.example .env      # fill in DB, JWT secret, keys, domain, org, relay
./setup/bootstrap.sh
```

See **ONBOARDING.md** for the full step-by-step (including system prerequisites and DNS/SSL).

## Status

Built in phases. See ONBOARDING.md for what's live vs pending.
