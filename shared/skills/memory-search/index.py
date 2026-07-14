#!/usr/bin/env python3
"""
Build/refresh an FTS5 SQLite index over an agent's memory + identity files.
Runs incrementally — skips files whose SHA256 hasn't changed since last index.

Generalized from Stan's opex/.claude/skills/memory-search/ implementation.
Fleet-wide: works for any agent dir via cwd (or AGENT_ROOT env var).

Index lives at: <agent-root>/data/memory.sqlite
Table: docs (path, title, content) — FTS5 virtual table

Sources indexed:
  <agent-root>/*.md                                (identity files at root)
  <agent-root>/memory/**/*.md                       (daily/session notes)
  <agent-root>/.claude/skills/*/SKILL.md            (own skill docs)
  <agent-root>/.claude/skills/shared/*/SKILL.md     (shared skill docs, if symlinked)
  <auto-memory dir>/*.md                            (Claude Code auto-memory layer)
"""
import os
import sqlite3
import hashlib
from pathlib import Path
import sys

ROOT = Path(os.environ.get("AGENT_ROOT", os.getcwd())).resolve()
DB_DIR = ROOT / "data"
DB_PATH = DB_DIR / "memory.sqlite"

# Claude Code's auto-memory layer lives outside the repo tree, keyed by the
# repo's absolute path with "/" flattened to "-". Same transform Claude Code
# itself uses for project session dirs.
AUTO_MEM = Path.home() / ".claude" / "projects" / str(ROOT).replace("/", "-") / "memory"


def init_db(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS file_meta (
      path TEXT PRIMARY KEY,
      mtime REAL NOT NULL,
      sha256 TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
      path UNINDEXED,
      title,
      content,
      tokenize='porter unicode61'
    );
    """)


def file_sources():
    """Yield Paths of files to index."""
    for p in ROOT.glob("*.md"):
        yield p
    for p in ROOT.glob("memory/**/*.md"):
        yield p
    for p in ROOT.glob(".claude/skills/*/SKILL.md"):
        yield p
    for p in ROOT.glob(".claude/skills/shared/*/SKILL.md"):
        yield p
    if AUTO_MEM.is_dir():
        yield from AUTO_MEM.glob("*.md")


def extract_title(text, fallback):
    for line in text.splitlines()[:5]:
        line = line.strip()
        if line.startswith("# "):
            return line.lstrip("# ").strip()
    return fallback


def rel_path(path):
    """Index key: repo-relative, or automemory/<name> for the auto-memory layer."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return f"automemory/{path.name}"


def index_file(con, path):
    text = path.read_text(errors="ignore")
    sha = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
    mtime = path.stat().st_mtime
    rel = rel_path(path)

    cur = con.execute("SELECT sha256 FROM file_meta WHERE path = ?", (rel,))
    existing = cur.fetchone()
    if existing and existing[0] == sha:
        return False

    title = extract_title(text, rel)
    if existing:
        con.execute("DELETE FROM docs WHERE path = ?", (rel,))
        con.execute("UPDATE file_meta SET mtime=?, sha256=? WHERE path=?", (mtime, sha, rel))
    else:
        con.execute("INSERT INTO file_meta (path, mtime, sha256) VALUES (?, ?, ?)", (rel, mtime, sha))

    con.execute("INSERT INTO docs (path, title, content) VALUES (?, ?, ?)", (rel, title, text))
    return True


def prune_deleted(con, current_paths):
    current_set = {rel_path(p) for p in current_paths}
    cur = con.execute("SELECT path FROM file_meta")
    on_disk = {row[0] for row in cur.fetchall()}
    gone = on_disk - current_set
    for path in gone:
        con.execute("DELETE FROM docs WHERE path = ?", (path,))
        con.execute("DELETE FROM file_meta WHERE path = ?", (path,))
    return len(gone)


def main():
    if not (ROOT / "CLAUDE.md").exists():
        print(f"ERR: {ROOT} doesn't look like an agent dir (no CLAUDE.md)", file=sys.stderr)
        return 1

    DB_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    init_db(con)

    paths = list(file_sources())
    updated = 0
    for p in paths:
        if index_file(con, p):
            updated += 1
    pruned = prune_deleted(con, paths)
    con.commit()

    cur = con.execute("SELECT count(*) FROM file_meta")
    total = cur.fetchone()[0]
    con.close()

    print(f"indexed: {total} files total · updated this run: {updated} · pruned: {pruned}")
    print(f"db: {DB_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
