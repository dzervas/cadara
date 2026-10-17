#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Run only when other builds/tests are idle. Baseline modules are loaded from
# the inspected commit; the working tree and dependencies are left intact.
CADARA_PROBE_BASELINE=1 node --cpu-prof \
  --cpu-prof-dir=scripts/region-research/results \
  --cpu-prof-name=baseline-clean.cpuprofile \
  --import ./scripts/region-research/loader.mjs \
  ./scripts/region-research/benchmark.mjs baseline-clean 3
node --cpu-prof \
  --cpu-prof-dir=scripts/region-research/results \
  --cpu-prof-name=final-clean.cpuprofile \
  --import ./scripts/region-research/loader.mjs \
  ./scripts/region-research/benchmark.mjs final-clean 3
node ./scripts/region-research/summarize.mjs baseline-clean final-clean
