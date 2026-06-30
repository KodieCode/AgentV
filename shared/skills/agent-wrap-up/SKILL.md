---
name: agent-wrap-up
description: Per-agent end-of-session checkpoint. Flush in-context work to disk before a tmux restart so the next session keeps today's decisions, completed work, and open threads.
---

# agent-wrap-up

Run when told to wrap up (typically before a session restart, or at end of day).

## When to use

| Trigger | Wrap up? |
|---|---|
| Told to "wrap up" / "save your work" / "before restart" | yes |
| About to be restarted | yes |
| Natural pause, want a checkpoint | yes |
| Just chit-chat, nothing meaningful done | no |

## Procedure

### 1. Write today's session note

File: `<your agent dir>/memory/YYYY-MM-DD-HHMM.md`

Cover, terse (5–20 lines):
- **Shipped this session** — bullet list
- **Decisions made** — with reasoning
- **Open threads / TODOs** — pending for next session
- **Coordination state** — in-flight notifies, expected replies, PRs awaiting merge
- **Anything the operator said worth remembering** — preferences, plans

### 2. Update MEMORY.md (3-tier)

```markdown
## Core
Stable identity facts — client/account IDs, permanent conventions approved by the operator, who you are. Changes rarely; never pruned unless demonstrably wrong.

## Semantic
Learned patterns — recurring fixes, tool gotchas, multi-session observations. Add when the same thing has bitten twice or a rule was approved. Entries with refs:0 and age > 90 days are pruning candidates.

## Episodic
Pointers to dated session notes in memory/. Newest first. Keep ~10.
```

**Access tracking** — every Core/Semantic entry ends with a ref marker:
```
- **Entry text.** [refs:0 last:-]
```
During wrap-up, for each entry you actually recalled this session, increment the count + set the date: `[refs:3 last:2026-06-26]`. New entries start `[refs:0 last:-]`.

**Promote** (don't dump everything):

| Promote | Tier | Don't promote |
|---|---|---|
| New permanent convention the operator approved | Core | Today's specific PR shipped |
| Client ID / key credential location confirmed | Core | A routine deploy you ran |
| Recurring incident + fix | Semantic | Status-quo confirmation |
| Tool gotcha that cost you time | Semantic | Anything observable from an API |
| Multi-session observation the operator validated | Semantic | Anything with an expiry date |

**Pruning:** during weekly review, flag `refs:0` + `last:-` or `last:` > 90 days as removal candidates — flag, don't auto-delete.

### 3. Commit (if your dir is git-tracked)

```bash
git add memory/ MEMORY.md
git commit -m "wrap-up: <one-line summary>"
```
If your repo pushes via PR, open one — don't leave unpushed drift on main.

### 4. Notify

```bash
.claude/skills/shared/notify/notify.sh --to <fleet-manager> "Wrap-up: <one-line>. Note: memory/<file>. Open: <one-line>."
```
Confirm ready for restart.
