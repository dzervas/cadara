# Local spline-region optimizations and tracing

Measured 2026-10-17 against `onshape-importer` commit `2d0ac345b6589c9fa7276aec7619c82b0ae14473`. The measurements below were captured before publication of this change.

## Result

The multi-span crossing fixture is **15.5× faster**, with identical full region output. Exact arithmetic remains the bottleneck, but most redundant integer-size bookkeeping is gone. This is a performance improvement, not a claim that all unsupported spline configurations are now supported.

| Fixture | Before, median | After, median | Speedup | Result before and after |
|---|---:|---:|---:|---|
| Multi-span crossing + closing line | 18,595.7 ms | 1,203.1 ms | 15.5× | Two regions, no diagnostics |
| Difficult decimal cubic pair | 21,538.7 ms | 1,166.3 ms | 18.5× | **Still uncertain: proof-budget exhausted** |
| Spline arch + closing line | 710.2 ms | 339.5 ms | 2.1× | One region, no diagnostics |
| Single-span self-crossing loop | 103.9 ms | 25.4 ms | 4.1× | One region, no diagnostics |
| Integer cubic pair | 74.5 ms | 30.0 ms | 2.5× | Three verified intersections |

Three repetitions per fixture, with a fresh region deriver for each repetition. These are cold query-cache timings, not cold JavaScript-engine timings. An identical cached derive is measured separately and subtracted from the table. All 15 full result objects match across revisions, including diagnostics, witnesses and region identities. Cached crossing derivation medians are 9.8 ms before and 4.1 ms after; the arch's cached median varies from 6.5 to 12.5 ms, so these small timings should not be read as a reliable optimization or regression.

Crossing ranges: 15.52–19.16 s before, 1.12–1.66 s after. Difficult-pair ranges: 18.95–27.20 s before, 1.11–1.62 s after. Only three samples: no p95 or statistical confidence claim. These are synthetic exported-query/region fixtures under Node v24.19.0 with CPU sampling enabled, not browser input-to-paint measurements or the user's actual failing Onshape sketch. Builds and tests were stopped/completed before the measured runs. Baseline and final runs use separate processes, the same case order and dependencies. Startup/JIT effects particularly affect the small integer case.

## What changed

1. **Exact integer size bookkeeping** (`fixed-degree-primitives.ts`): compute bit length from hexadecimal rather than binary strings; retain a bounded four-operand size cache for repeated pre-product checks; remember the largest successfully checked stored magnitude. A smaller magnitude cannot increase the recorded maximum or violate a ceiling already passed by the larger value, so it needs no string conversion. Rejected values never enter that shortcut. Arithmetic charges and configured limits are unchanged.
2. **Sparse resultant expansion** (`cubic-pair-exact.ts`): skip a zero polynomial coefficient before recursively computing its determinant minor. The representative cubic/cubic expansion visits 104 terms instead of 768. Metered work legitimately decreases; no budget is raised.
3. **Join-box boundary pruning** (`region-extraction.ts`): use conservative existing curve bounds to reject box sides that cannot meet the branch. Touching boxes remain candidates. Arch ordinary pair-query counts fall from 24 to 13 per fresh derive; crossing counts fall from 25 to 16. This does not skip the declared joins or the actual crossing query.

The first implementation, before the largest-stored-magnitude shortcut, measured 3.78 s for crossing and 3.59 s for the difficult pair. Profiling prompted the additional shortcut, bringing them to 1.20 s and 1.17 s. All per-query budget snapshots match between those two patch stages, confirming that the additional speedup removes bookkeeping rather than metered proof work.

## Where the time goes

CPU samples across the complete 15-case run, including startup and result serialization:

| Function, sampled self time | Before | Final |
|---|---:|---:|
| `bigintBitLength` | 107.06 s (84.3%) | 0.98 s (9.9%) |
| `gcdBigInt` | 9.62 s (7.6%) | 5.11 s (51.9%) |
| Four-entry bit-size cache lookup | — | 0.41 s (4.1%) |
| Garbage collection | 3.07 s (2.4%) | 0.29 s (3.0%) |
| Total sampled time | 126.95 s | 9.85 s |

Inclusive time is hierarchical and must not be added: final curve-pair queries account for 8.45 s; `certifyCubicPairExact` accounts for 6.95 s; GCD including children accounts for 5.36 s. Polynomial remainder/GCD and algebraic sign evaluation are the remaining expensive exact operations.

The query trace separates ordinary pair, declared-join and same-span self queries. In the original middle crossing repetition, one ordinary cubic-pair query alone took 17.46 s of the 18.60 s derivation. This is why optimizing the arrangement graph or same-span self-intersection formula would miss the main issue. In the final run, the crossing's ordinary pair queries total 3.90 s across three repetitions; declared joins total 29 ms and self queries 15 ms. The graph/region work outside queries is a small fraction of the crossing cost.

The difficult pair still hits 1,500,001 Euclidean steps at the unchanged 1,500,000-step cap, with a 15,470-bit maximum stored integer. Faster bookkeeping cannot certify a case that still exhausts the proof budget. The successful crossing's heavy query drops from 1,447,741 to 1,290,323 Euclidean steps through sparse determinant work; its maximum integer size remains 14,790 bits.

## Traces and reproduction

The harness and compact comparison summary are versioned. Raw profiles, full measurements and validation logs are local research artifacts, excluded from this change. The following trace/measurement paths are generated by the reproduction command.

- `results/baseline-clean/trace.json` and `results/final-clean/trace.json`: Chrome Trace Event format. Open in Perfetto or a compatible trace viewer. Case spans are on thread 2; individual query spans and budget snapshots on thread 1.
- `results/baseline-clean.cpuprofile` and `results/final-clean.cpuprofile`: import in Chrome DevTools' JavaScript Profiler to inspect sampled stacks, self time and inclusive time.
- `results/{baseline-clean,final-clean}/measurements.json`: full outputs, every measured query, timings and proof-budget counters.
- `results/patched-clean/` and its CPU profile preserve the intermediate patch stage.

```sh
bash scripts/region-research/run-comparison.sh
```

Requires Node 24 with TypeScript stripping. `loader.mjs` loads the three original production modules directly from the pinned Git commit for the baseline, without changing the worktree. The second process loads the current files. The summary checks complete output parity. Run without concurrent tests/builds. Earlier files outside these named result directories are exploratory measurements, not the basis for the table above.

## Validation and remaining work

`docs/testing.md` was reviewed. Tests use the **logic lane**, at the exported exact-budget, certified-curve-query and region-derivation seams. This exercises numeric guarantees and arrangement behavior without adding UI orchestration or native OCC to a pure geometry check.

All **467 tests in the nine neutral-curve-certification suites** and **11 selected region regressions** pass on the final implementation. The region selection covers figure-eight lobes, mixed crossings, declared joins, conservative blocking, near tangency, overlaps and cache eviction. Added signed size-boundary tests extend through 16,384 bits and verify repeated rejection, pre-product and shift limits. Existing determinant and aggregate-budget tests were updated to reflect reduced work while preserving their original correctness requirements.

Final application typechecking, changed-file ESLint, Prettier checks and `git diff --check` pass. Repository-wide lint and the production build passed before the final stored-magnitude refinement; that refinement was subsequently typechecked and tested as above. `bun run test:all` was attempted: an initially missing `bunx` launcher was repaired and its stages resumed individually. Spec typechecking fails because the checkout has no `@playwright/test` dependency, producing missing-module and downstream type errors. The unrestricted geometry/region run was interrupted after roughly ten minutes; it had also loaded an old version of the aggregate-budget test before that test was corrected. The final certification suite and targeted region reruns pass. The full repository gate is **not** claimed green, and browser interaction/OCC face-extrusion validation was not performed. Local logs are in `results/validation/` (not versioned).

The next algorithmic improvement is a **certified subdivision/intersection filter before exact resultants**, with an honest completeness proof and exact fallback for unresolved cells. The earlier local subdivision-filter experiment remains a research prototype; it is not included in this change or wired into production. General parameter domains, boundary roots, tangencies, overlaps, witness provenance and verification require further work before it can replace exact queries. Retaining useful query results across worker cancellation is another separate improvement for dragging. Neither should be confused with the local arithmetic optimizations measured here.
