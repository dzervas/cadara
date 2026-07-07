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
