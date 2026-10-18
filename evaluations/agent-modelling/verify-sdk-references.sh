#!/usr/bin/env bash
# Qualify the shipped SDK script/replay seam against the unchanged reference parts/checker.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cli=${CADARA_CLI:-$here/../../dist-cli/main.js}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
status=0
for task in t1 t2 t3 t4 t5; do
  dir=$work/$task
  mkdir -p "$dir"
  if [ "$task" = t4 ]; then cp "$work/t1/plate.cadara" "$dir/"; fi
  for recipe in "$here/reference/$task"/*.json; do
    cp "$recipe" "$dir/reference.json"
    cat > "$dir/reference-sdk.ts" <<'SCRIPT'
import { readFile } from "node:fs/promises";
export default async function (doc) {
  const recipe = JSON.parse(await readFile("reference.json", "utf8"));
  const results = await doc.replay(recipe);
  if (results.length !== recipe.operations.length || results.some((r) => r.outcome.kind !== "completed"))
    throw new Error("SDK reference replay did not complete every operation");
  return doc.inspect(["bounds", "topologyCounts"]);
}
SCRIPT
    (cd "$dir" && bun "$cli" script reference-sdk.ts >sdk.out.json 2>sdk.err.txt) || { echo "$task: $(basename "$recipe") failed"; cat "$dir/sdk.err.txt"; status=1; }
  done
  verdict=$(CADARA_CLI=$cli python3 "$here/checker.py" "$task" "$dir")
  echo "$task: $(python3 -c 'import json,sys; v=json.loads(sys.argv[1]); print("pass" if v["pass"] else "FAIL", v["parametric_score"] or "")' "$verdict")"
  python3 -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1])["pass"] else 1)' "$verdict" || status=1
done
exit $status
