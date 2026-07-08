# Change Notes: Kernel Topology Signatures

## 2026-07-07 Payload verification gate

Task 1.1 verified the current checked-in OCC wasm build populates real exact-B-rep records needed by topology signature extraction.

Evidence:
- Ran logic-lane gate spec: `node node_modules/vitest/vitest.mjs run src/domain/modeling/occ/native-topology-payload.spec.ts`.
- Existing native payload assertions cover box and cylinder payloads:
  - planar box faces are emitted as analytic `plane` surfaces.
  - box edges are emitted as analytic `line` curves.
  - cylinder side faces are emitted as analytic `cylinder` surfaces.
  - cylinder trim edges are emitted as analytic `circle` curves.
- Added cone/sphere gate assertions in `src/domain/modeling/occ/native-topology-payload.spec.ts`:
  - bounded cone faces are emitted as analytic `cone` surfaces with non-empty `tables.surfaces` metadata.
  - bounded sphere faces are emitted as analytic `sphere` surfaces with non-empty `tables.surfaces` metadata.

Result: **pass**. No native shim blocker found for plane, cylinder, cone, sphere, line, or circle records.

## 2026-07-07 Fixture capture

Task 1.2 captured representative native payload fixtures under `src/domain/modeling/occ/fixtures/topology-signatures/`:

- `box.payload.json`: box body; exact-B-rep summary has 6 plane faces, 12 line edges, 8 vertices.
- `cylinder-boss.payload.json`: cylinder boss body; exact-B-rep summary has plane + cylinder faces and line + circle edges.
- `filleted-block.payload.json`: box after a native fillet transaction; exact-B-rep summary has plane + cylinder faces and line + circle edges.

Each fixture stores both the flat native topology payload and the exact-B-rep payload, plus a compact summary for quick inspection.

## 2026-07-07 Live Onshape smoke

Credentials were loaded by sourcing `.envrc` in a non-echoing subshell; the file contents and environment values were not inspected or printed.

Captured both provided Onshape documents through the live capture command path using a temporary Vitest smoke harness because `bun` was not available in this shell:

- `40a51fb8fa82fd4565151114` → `/tmp/cadara-onshape-smoke-1.onshape-capture.json` (9.1 MiB)
- `9841e486906fa2ce62d74d8e` → `/tmp/cadara-onshape-smoke-2.onshape-capture.json` (24 MiB)

Reviewed the captured bundles through the Onshape provider headless review path:

| Document | Part Studio | Features | parametric | baked | geometryOnly | Verification |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `40a51fb8fa82fd4565151114` (HackerBoard) | Mounts | 10 | 6 | 4 | 0 | unavailable |
| `9841e486906fa2ce62d74d8e` (Taskariki) | Part Studio 1 | 41 | 6 | 35 | 0 | unavailable |

Reason breakdown:

| Document | `needs-region-resolution` | `needs-history-probe` | `downstream-of-baked` |
| --- | ---: | ---: | ---: |
| HackerBoard / Mounts | 1 | 3 | 3 |
| Taskariki / Part Studio 1 | 16 | 19 | 24 |

Headless provider → prepare → apply smoke also passed using the real sketch solver with `MockKernelAdapter`:

| Document | Applied ops | Created sketches | Created features | Error diagnostics |
| --- | ---: | ---: | ---: | ---: |
| HackerBoard / Mounts | 6 | 1 | 1 | 0 |
| Taskariki / Part Studio 1 | 6 | 3 | 0 | 0 |

Comparison: counts match the post-correlation baseline recorded in `openspec/changes/archive/2026-07-07-add-onshape-import-provider/notes/tier-baseline.md`. Deviation verification remains unavailable because the current Onshape provider review path still reports `verificationUnavailable(...)` and does not consume `capabilities.history`; task 4.1 remains the activation blocker.

## 2026-07-08 Probe-present Onshape activation

Activated the Onshape review path against `ImportCapabilities.history` for the approved face-sketch-only scope:

- `review()` runs the history probe and `prepare()` consumes the verified review plan rather than recomputing probe-less planning.
- Unique face-plane signature matches promote `newSketch` from baked to parametric with `sketch-on-probed-face`; prepared sketch commits carry the matched face support.
- Ambiguous probe matches remain baked with `needs-history-probe`.
- Topology features that remain untranslatable after a probe is present now report `translator-unavailable` instead of blaming probe absence.
- `HistoryProbeInput` supports `includeFinalTessellation`; `HistoryProbeResult` can carry an optional final tessellation sample for future full-model verification. Current provider reports partial verification whenever baked features remain, avoiding misleading full-model deviation numbers.

Validation run:

- `node node_modules/typescript/bin/tsc -b ./tsconfig.app.json --pretty false`
- `node node_modules/vitest/vitest.mjs run src/domain/import/onshape/provider.spec.ts src/domain/import/onshape/apply-pipeline.spec.ts src/domain/import/onshape/fidelity-planner.spec.ts src/domain/import/kernel-history-probe.spec.ts src/domain/import/onshape/signature-matcher.spec.ts src/domain/import/onshape/ground-truth.spec.ts src/domain/modeling/occ/topology-signatures.spec.ts`


## 2026-07-08 Prefix probe refinement

Refined the provider activation to build the real parametric candidate prefix during `review()` and pass that `ImportPreparedActions` payload into `evaluateHistoryProbe`. `prepare()` still consumes the verified review plan. The probe runner now applies the sandbox revision over prepared requests so stale capture/request revisions cannot break review-time sandboxing.

Face-sketch matching now uses topology from the probed prefix. For capture v1, final-prefix topology is the matching state; this carries the same caveat as capture v1 final-state references: if Onshape does not provide a usable final-state signature for a reference, only narrow swept-face query inference can recover it.

Added provider-level real-probe coverage using `createKernelHistoryProbeSession` over `MockKernelAdapter` with the real sketch solver. The synthetic fixture has a base sketch/extrude prefix and a downstream face sketch; stub tests remain for ambiguous matches.

Validation run:

- `node node_modules/typescript/bin/tsc -b ./tsconfig.app.json --pretty false`
- `node node_modules/vitest/vitest.mjs run src/domain/import/onshape/provider.spec.ts src/domain/import/onshape/apply-pipeline.spec.ts src/domain/import/onshape/fidelity-planner.spec.ts src/domain/import/kernel-history-probe.spec.ts src/domain/import/onshape/signature-matcher.spec.ts src/domain/import/onshape/ground-truth.spec.ts src/domain/modeling/occ/topology-signatures.spec.ts`

Saved-capture baseline rerun in this node shell could not exercise the browser OCC probe runtime (`window`/worker unavailable), so HackerBoard and Taskariki counts remained at the previous node-only baseline. A browser/runtime-backed rerun is still needed to observe the expected HackerBoard Sketch 2 → Extrude 2 flip.


## 2026-07-08 Verification and probe-wired baseline correction

Fixed verification plumbing: when a history probe capability is present and the reviewed plan has zero baked features, the provider now compares `probeResult.finalTessellation` against the bundle ground-truth tessellation via `compareTessellation`. Baked plans still report `partial`; `unavailable` is reserved for absent history capability.

Re-ran the saved captures with a real `createKernelHistoryProbeSession` over `MockKernelAdapter` + real solver, matching the provider spec harness pattern. Results:

- HackerBoard / Mounts: 6 parametric, 4 baked, 1 remaining `needs-history-probe`; verification partial (4 baked). Sketch 2 did **not** flip.
- Taskariki / Part Studio 1: 6 parametric, 35 baked, 10 remaining `needs-history-probe`; verification partial (35 baked).

Investigation: HackerBoard Sketch 2 references a swept face of Extrude 1 through a compressed Onshape query. The saved solved-sketch capture contains the base sketch entity id, and the provider now tolerates the compressed suffix, but the MockKernel exact-B-rep fixture used by the node harness does not represent the saved capture's Extrude 1 topology. Therefore the probed signature set still has no unique match for Sketch 2 in this harness. This is an honest no-move baseline for the available MockKernel probe harness; verifying the expected Sketch 2 → Extrude 2 flip still requires a probe topology source that reflects the rebuilt candidate geometry rather than the static box fixture.


## 2026-07-08 Deferred probe materialization + captured frames

Fixed the real probe session to share the orchestrator's deferred materialization path. `regionOf` and `bodyOf` placeholders are now resolved against recorded ordered-action outputs in the probe, so candidate prefixes containing extrudes can rebuild instead of failing at the first solid feature. The probe now records sketch/body outputs and no longer passes raw deferred feature requests through `as never`.

Added `sketch-on-captured-frame`: if a sketch plane reference already has a captured planar face signature, the provider commits the sketch on a fixed construction-frame support derived from that signature. This is intentionally non-associative to the source Onshape construction/cPlane, so it reports a separate reason code instead of claiming probe-backed face associativity.

Probe-wired saved-capture rerun with `createKernelHistoryProbeSession` over `MockKernelAdapter` + real solver:

- HackerBoard / Mounts: 6 parametric, 4 baked, 1 `needs-history-probe`, 0 `sketch-on-captured-frame`.
- Taskariki / Part Studio 1: 8 parametric, 33 baked, 8 `needs-history-probe`; captured-frame sketches: `Screen Outline`, `Sketch 2`.

Taskariki's cPlane-gated sketches now flip without a cPlane translator. Extrude 1 remains baked in this harness because the currently available sketch-region translation/selection still reports `needs-region-resolution`; chamfers/shell/boolean/delete remain `translator-unavailable` as expected.


Added regression coverage for the specific deferred-materialization failure: `kernel-history-probe.spec.ts` now probes a sketch → extrude(`regionOf`) candidate through `createKernelHistoryProbeSession` over `MockKernelAdapter` + real solver and asserts the extrude step rebuilds with face signatures.
