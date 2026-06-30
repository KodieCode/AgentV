#!/usr/bin/env bash
# port-allocate — pick the next free port for a new app/api. Avoids clashes by
# checking BOTH the projects table (recorded app_port/api_port) and live
# listeners (ss). The projects table is the durable port registry.
#
# Usage:
#   allocate.sh            -> print one free port
#   allocate.sh --pair     -> print "<app_port> <api_port>" (two consecutive free)
#   allocate.sh --from 8200 --to 8999   -> restrict the search range
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/agentv-env.sh"

FROM="${PORT_RANGE_FROM:-8200}"; TO="${PORT_RANGE_TO:-8999}"; PAIR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pair) PAIR=1; shift ;;
    --from) FROM="$2"; shift 2 ;;
    --to)   TO="$2"; shift 2 ;;
    *) echo "usage: allocate.sh [--pair] [--from N] [--to N]" >&2; exit 2 ;;
  esac
done

# Ports already recorded in the registry (projects table).
RECORDED="$(agentv_mysql -e "SELECT app_port FROM projects WHERE app_port IS NOT NULL
                              UNION SELECT api_port FROM projects WHERE api_port IS NOT NULL;" 2>/dev/null | tr '\n' ' ')"
# Ports with a live listener right now.
LIVE="$(ss -tlnH 2>/dev/null | grep -oE ':[0-9]+' | tr -d ':' | sort -u | tr '\n' ' ')"
USED=" $RECORDED $LIVE "

free() { case "$USED" in *" $1 "*) return 1 ;; *) return 0 ;; esac; }

found=()
p=$FROM
while [ "$p" -le "$TO" ]; do
  if free "$p"; then
    if [ "$PAIR" = 1 ]; then
      q=$((p+1))
      if [ "$q" -le "$TO" ] && free "$q"; then echo "$p $q"; exit 0; fi
    else
      echo "$p"; exit 0
    fi
  fi
  p=$((p+1))
done
echo "ERR: no free port(s) in range $FROM-$TO" >&2; exit 1
