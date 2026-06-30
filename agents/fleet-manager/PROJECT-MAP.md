# PROJECT-MAP — Fleet Manager (`fleet-manager`)

You don't own a single app — you own the **fleet's orchestration surface** and the
**platform repos**. This map is your registry of what exists and who keeps each
project. Keep it in sync with the control-plane `projects` table (the source of
truth: `projects.agent_id` names the keeper).

Config-derived values come from `.env` — reference them (`$GITHUB_ORG`,
`$DASHBOARD_DOMAIN`, `$APP_DOMAIN_BASE`, `$MYSQL_DATABASE`), never hardcode.

---

## Platform repos you own (deploy yourself)

### control-plane  (the dashboard + API)

- **What it is:** the fleet's web control plane — agent roster + live pulse,
  per-agent terminal, ideas kanban, scheduler, reports.
- **Local path:** `<AgentV repo>/control-plane/` (api + app)
- **Repo:** `$GITHUB_ORG/<control-plane repo>`
- **Stack:** Express API + Vite/React app, MySQL control-plane schema (`$MYSQL_DATABASE`).
- **Run / build:** see `control-plane/` package scripts.
- **Deploy target:** the control-plane host; pm2 entries for api + app; served at `$DASHBOARD_DOMAIN`.
- **Gotcha:** self-deploy — never `pm2 restart` the api inline from a command the
  api is running; use a detached restart. `pm2 restart` is the LAST step.

### shared layer  (skills + lib + knowledge)

- **What it is:** the reusable agent infrastructure (`shared/skills`, `shared/lib`,
  `shared/knowledge`) every agent symlinks in.
- **Local path:** `<AgentV repo>/shared/`
- **Deploy:** no service — changes take effect on next skill invocation. Commit + PR.

---

## Fleet roster (who keeps what)

Mirror of the `agents` + `projects` tables — keep current as agents are added.

| Agent (slug) | Owns | Reports to |
|---|---|---|
| `fleet-manager` | orchestration + platform repos | the human operator |
| `finance-builder` | the finance-automation project (ingest → transform → dashboard) | `fleet-manager` |

<!-- Add a row per agent the operator provisions. -->

---

## Deploy notes

Golden rule across every repo: **`pm2 restart` is always the LAST step** — after
all file writes, `git pull`, `npm run build`, and stash-pop have completed.
For platform repos, use a detached/nohup restart so a self-restart survives.
Project-app deploys are the owning agent's responsibility — you delegate.
