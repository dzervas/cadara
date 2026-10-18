#!/usr/bin/env bash
# Replays every reference recipe chain in a scratch directory and runs the checker on it.
# Requires a built CLI: `bun run build:cli` (or set CADARA_CLI to another main.js).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cli=${CADARA_CLI:-$here/../../dist-cli/main.js}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
status=0
for task in t1 t2 t3 t4 t5; do
  dir=$work/$task
  mkdir -p "$dir"
  # T4 edits the plate produced by the T1 reference.
  if [ "$task" = t4 ]; then cp "$work/t1/plate.cadara" "$dir/"; fi
  for recipe in "$here/reference/$task"/*.json; do
    cp "$recipe" "$dir/"
    (cd "$dir" && bun "$cli" document recipe "$(basename "$recipe")" >/dev/null 2>&1) || { echo "$task: $(basename "$recipe") failed"; status=1; }
  done
  verdict=$(CADARA_CLI=$cli python3 "$here/checker.py" "$task" "$dir")
  echo "$task: $(python3 -c 'import json,sys; v=json.loads(sys.argv[1]); print("pass" if v["pass"] else "FAIL", v["parametric_score"] or "")' "$verdict")"
  python3 -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1])["pass"] else 1)' "$verdict" || status=1
done
exit $status
