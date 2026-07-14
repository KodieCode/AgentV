---
name: memory-search
description: FTS5 SQLite full-text index over an agent's memory + identity files. Use for finding past decisions, session notes, or any text the agent has written. Faster + more flexible than grep once memory grows. Fleet-shared — every agent gets this via the .claude/skills/shared symlink.
metadata:
  category: memory
  requires:
    bins: [python3, sqlite3]
---

# memory-search — full-text search over an agent's writing

Generalized from Stan's `opex/.claude/skills/memory-search/` (proven, actively maintained since 2026-05).
Lives once in `_shared/skills/memory-search/`, reachable by every agent via its `.claude/skills/shared` symlink.

Indexes, relative to the calling agent's root dir:
- All `*.md` at the agent root (identity files — `CLAUDE.md`, `SOUL.md`, `MEMORY.md`, etc.)
- All of `memory/**/*.md` (session/daily notes)
- All `.claude/skills/*/SKILL.md` (agent's own skills)
- All `.claude/skills/shared/*/SKILL.md` (fleet-shared skills, if symlinked)
- The Claude Code auto-memory layer for this agent dir (`~/.claude/projects/<flattened-path>/memory/*.md`)

## Path resolution

Scripts default `AGENT_ROOT` to `$(pwd)` — **always run from the agent's identity dir**, same convention as `weekly-review` and `build-idea`. Override with the `AGENT_ROOT` env var if calling from elsewhere:

```bash
cd ~/Projects/agents/<slug>   # or ~/Projects/norman-cc, ~/Projects/clive-cc, ~/Projects/opex
.claude/skills/shared/memory-search/index.py
```

Refuses to run if `CLAUDE.md` isn't found at `AGENT_ROOT` (guards against indexing the wrong dir).

## Search

```bash
.claude/skills/shared/memory-search/search.py "<query>"
```

Options:
- `--max N` — cap results (default 10)
- `--raw` — JSON output (for piping)
- `--path memory/` — restrict to a subdir

### Examples

```bash
search.py "RDS password rotation"
search.py "provisioning checklist" --path memory/
search.py "deploy ordering rule" --raw
```

Output sorted by BM25 relevance. Snippets show matching context with `<<term>>` highlights.

## Index lifecycle

Built incrementally — only re-indexes files whose SHA256 changed. Index lives at `<agent-root>/data/memory.sqlite` (single file, ~10-20KB per indexed MD file). The index is a local cache, not source of truth, and must never be committed:

- Agents living in this repo (`~/Projects/agents/<slug>/`) are covered by the root `.gitignore` (`*/data/memory.sqlite`).
- Agents in their own repo (norman-cc, clive-cc, opex/stan) must add `data/memory.sqlite` to their repo's `.gitignore` **before first index run**.

Requires FTS5 compiled into Python's `sqlite3` (stock Ubuntu/Debian builds have it — verified CM 2026-07-14, sqlite 3.45.1). Quick check: `python3 -c "import sqlite3; sqlite3.connect(':memory:').execute('CREATE VIRTUAL TABLE t USING fts5(x)')"`.

Reindex during [[agent-wrap-up]] — see that skill's step 1b. Cron refresh is optional per-agent (Stan's opex runs one every 5 min); most agents are fine reindexing once per session at wrap-up.

## When to use vs `grep`

- **Prefer search.py** for: multi-word queries, fuzzy/stemming matches, ranked relevance, phrase search
- **Prefer grep** for: exact regex, scanning specific small files, one-off greps you're confident on

## When to update the index manually

Wrap-up handles it, but if you've just written a memory file and need to search it RIGHT NOW:

```bash
.claude/skills/shared/memory-search/index.py
.claude/skills/shared/memory-search/search.py "<query>"
```
