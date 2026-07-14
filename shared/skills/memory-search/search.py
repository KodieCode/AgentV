#!/usr/bin/env python3
"""
FTS5 search over an agent's memory + identity files.
Generalized from Stan's opex/.claude/skills/memory-search/ implementation.

Usage (run with cwd = agent dir, or set AGENT_ROOT):
  search.py "<query>"                    — top 10 matches
  search.py "<query>" --max 5            — limit
  search.py "<query>" --raw              — JSON output
  search.py "<query>" --path memory/     — restrict to subdir
"""
import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(os.environ.get("AGENT_ROOT", os.getcwd())).resolve()
DB = ROOT / "data" / "memory.sqlite"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--max", type=int, default=10)
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--path", default="", help="filter by path prefix (e.g. 'memory/')")
    args = ap.parse_args()

    if not DB.exists():
        print(f"index not built yet — run index.py first (looked in {DB})", file=sys.stderr)
        sys.exit(1)

    con = sqlite3.connect(DB)
    sql = """
      SELECT path, title, snippet(docs, 2, '<<', '>>', '...', 20) AS hit, bm25(docs) AS rank
      FROM docs
      WHERE docs MATCH ?
    """
    params = [args.query]
    if args.path:
        sql += " AND path LIKE ? "
        params.append(args.path + "%")
    sql += " ORDER BY rank LIMIT ?"
    params.append(args.max)

    rows = list(con.execute(sql, params))
    con.close()

    if args.raw:
        print(json.dumps([
            {"path": r[0], "title": r[1], "snippet": r[2], "rank": r[3]}
            for r in rows
        ], indent=2))
        return

    if not rows:
        print(f"no matches for: {args.query}")
        return

    for path, title, hit, rank in rows:
        print(f"\n{path}  —  {title}")
        clean = " ".join(hit.replace("\n", " ").split())
        print(f"  {clean}")


if __name__ == "__main__":
    main()
