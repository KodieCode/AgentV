# PROJECT-MAP — {{AGENT_NAME}} (`{{AGENT_SLUG}}`)

The project(s) you own, end to end. Keep this accurate — the `build-idea` and
`weekly-review` skills read it to find the right repo + paths. Whenever you touch
a project, sanity-check its entry here and fix any drift.

Config-derived values (host, domain base, GitHub org) come from the repo `.env` —
don't hardcode them here; reference them as `$APP_DOMAIN_BASE`, `$GITHUB_ORG`, etc.

---

## Projects

{{PROJECTS}}

<!-- One block per project you own. Template:

### <project-name>  (slug: <project-slug>)

- **What it is:** one-line description.
- **Local path:** /path/to/<project-name>            # working copy on this host
- **Repo:** $GITHUB_ORG/<repo>                        # where PRs go
- **Stack:** e.g. Vite/React + Express + MySQL + JWT
- **Run / build / test:**
  - dev:   `<command>`
  - build: `<command>`
  - test:  `<command>`
- **Deploy target:** host + process manager entry + domain(s)
  - host: <host code>
  - process: pm2 `<name-api>`, `<name-app>`
  - domains: `<name>.$APP_DOMAIN_BASE`, `<name>-api.$APP_DOMAIN_BASE`
- **Database:** schema `<db_name>` on the shared MySQL (control plane records it on the project row).
- **Gotchas:** anything non-obvious — env quirks, migration order, deploy ordering, etc.

-->

---

## Deploy notes

<!-- How your project(s) ship. Mirror the control-plane `projects.deploy_notes`.
Golden rule: `pm2 restart` is always the LAST step — after every file write,
git pull, build, and stash-pop have completed. Restarting before source lands
serves stale code silently. -->
