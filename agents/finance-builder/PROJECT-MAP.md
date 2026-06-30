# PROJECT-MAP — Finance Builder (`finance-builder`)

The finance project you own, end to end. Keep this accurate — `build-idea` and
`weekly-review` read it to find the right repo + paths. Config-derived values come
from `.env` (`$GITHUB_ORG`, `$APP_DOMAIN_BASE`, `$ACCOUNTING_SYSTEM`,
`$MYSQL_DATABASE`) — reference them, don't hardcode.

---

## Projects

### finance  (slug: finance)

- **What it is:** the finance-automation pipeline + dashboard — pulls from the
  accounting system, reconciles, and surfaces KPIs (P&L, cashflow, aged AR/AP,
  budget vs actual).
- **Local path:** `<AgentV repo>/<finance project dir>/`  _(set once scaffolded)_
- **Repo:** `$GITHUB_ORG/<finance repo>`
- **Stack:** Vite/React app + Express API + MySQL (per-project schema) + JWT
  (the AgentV per-project boilerplate). Accounting integration via `$ACCOUNTING_SYSTEM`'s API/connector.
- **Run / build / test:**
  - dev:   `<command>`
  - build: `<command>`
  - test:  `<command>`
- **Pipeline:**
  - **ingest** — `<command/cron>` pulls from `$ACCOUNTING_SYSTEM` into raw tables (idempotent, incremental).
  - **transform** — `<command>` builds reporting tables (deterministic, re-runnable).
  - **dashboard** — the web app reads reporting tables; numbers must reconcile to source.
- **Deploy target:**
  - host: `<host code>`
  - process: pm2 `finance-api`, `finance-app`
  - domains: `finance.$APP_DOMAIN_BASE`, `finance-api.$APP_DOMAIN_BASE`
- **Database:** schema `<finance db>` on the shared MySQL (control plane records it on the project row).
- **Accounting connector:** provider = `$ACCOUNTING_SYSTEM`; credentials live in the
  connector / project `.env` — never in the repo. Registered in the control-plane
  `connectors` table.
- **Gotchas:**
  - Money as integer minor units / fixed decimals — never floats. Track currency.
  - Read-only against the books by default; write-backs need per-action operator approval.
  - Reconcile totals to source before shipping any transform/dashboard change.
  - `pm2 restart` is the LAST deploy step — after every write/pull/build.

---

## Deploy notes

Standard AgentV app deploy: pull → install → migrate (if schema changed) → build →
**then** `pm2 restart finance-api finance-app`. Restarting before source lands
serves stale code silently. Run an ingest + reconcile smoke-check after deploy.
