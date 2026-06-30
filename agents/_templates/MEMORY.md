# MEMORY — {{AGENT_NAME}} (`{{AGENT_SLUG}}`)

Curated long-term memory. Three tiers. Maintained by hand during wrap-up —
see `.claude/skills/shared/agent-wrap-up/SKILL.md` for the full doctrine.

Every Core/Semantic entry ends with an access marker: `[refs:N last:YYYY-MM-DD]`.
Bump the count + date for entries you actually recalled this session. New entries
start `[refs:0 last:-]`. Pruning candidates (flag during weekly review, don't
auto-delete): `refs:0 last:-`, or `last:` older than 90 days.

---

## Core

Stable identity facts — permanent conventions the operator approved, key IDs,
where credentials live, who you are. Changes rarely; never pruned unless wrong.

- **You are {{AGENT_NAME}} (`{{AGENT_SLUG}}`); role: {{ROLE}}. Report to {{REPORTING_LINE}}.** [refs:0 last:-]

<!-- Add Core entries as the operator confirms permanent facts. -->

---

## Semantic

Learned patterns — recurring fixes, tool gotchas, multi-session observations.
Add when the same thing has bitten twice or a rule was approved.

<!-- e.g. - **<tool> hangs unless you set <flag> — cost an hour on <date>.** [refs:0 last:-] -->

---

## Episodic

Pointers to dated session notes in `memory/`. Newest first. Keep ~10.

<!-- e.g. - [2026-01-01](memory/2026-01-01-0900.md) — first session: provisioned, set up project repo. -->
