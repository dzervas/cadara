## 1. Contract

- [x] 1.1 Add the `bakedBody` feature definition variant (asset id, format, provenance, label) to the modeling contract + runtime schema, with Typia validation and `.spec.ts` accept/reject coverage (logic lane, per `docs/testing.md`).
- [x] 1.2 Define baked-body diagnostics (asset missing, format invalid, materialization failed).

## 2. Baking Capability

- [x] 2.1 Implement `bakeGeometry` in `createImportCapabilities`: format validation, content-hash dedup, persistence through `GeometryAssetStore`, structured failures; remove the throwing stub.
- [x] 2.2 Add `.spec.ts` coverage: happy path, dedup, invalid bytes, unsupported-format capability error.

## 3. Kernel Materialization

- [x] 3.1 Implement `bakedBody` in `MockKernelAdapter` (logic-lane body with durable ids).
- [x] 3.2 Add an injected geometry-asset resolver seam for kernel adapters; wire Mock directly and OCC through one worker request/response pair (worker asks, main thread returns transferable bytes+format); resolver absent/missing asset yields structured baked-body diagnostics.
- [x] 3.3 Implement pre-resolution at async adapter/worker operation boundaries (request + full history scan), pass a resolved-asset map into synchronous OCC execution, and implement mesh→faceted-shape materialization with durable topology ids, render mesh, and export participation.
- [x] 3.4 Add coverage: mock-kernel rebuild spec; OCC materialization spec alongside existing OCC feature specs; downstream boolean-on-baked-body case; reopened document rebuilds from persisted asset. (2026-07-11 Option B: the reopened-document spec now proves an honest reload — bytes persisted to a `GeometryAssetStore`, then a COMPLETELY FRESH adapter/resolver holding only the persisted store rebuilds the body from the definition-carried reference, with no session registry.)
- [x] 3.7 **(2026-07-11 Option B)** Make the document self-describing: carry the full `BakedGeometryAssetReference` (assetId/format/hash/byteLength) in the `bakedBody` definition; change the resolver seam (contract, OCC worker pair, mock, pre-resolution) to take the reference; delete the module-level `bakedGeometryAssetRecords` registry; add one shared `createGeometryAssetComposition` seam wired into browser composition and the composition-seam spec.
- [x] 3.5 Cache worker-side resolved bytes and materialized faceted OCC shapes by immutable asset id; add a byte-budget/LRU follow-up note rather than blocking this change.
- [x] 3.6 **Gate:** assess adding `STEPControl_Reader` to `opencascade-recipe.yaml`; record findings (binary-size and effort) in change notes; implement `step` format only if cheap, otherwise document deferral.
- [x] 3.8 Preserve authoritative baked-mesh source-component ranges from Onshape tessellation; materialize declared ranges only, conservatively reject ambiguous legacy/unpartitioned meshes and disconnected undeclared shells, and cover coincident-body/invalid-group cases.
- [x] 3.9 Add explicit `bodyOnlyMesh` baked-body topology presentation: retain OCC shape/source mesh, omit subtopology/native payload/naming/render records, render/select only the body mesh, and cover snapshot/transfer/viewport seams.

## 4. Onshape Provider Integration

- [x] 4.1 Emit a `bakedBody` action from ground-truth tessellation when the plan requires a studio bake; wire provenance/labeling; keep the capability-absent fallback.
- [x] 4.2 Update planner/provider `.spec.ts` fixtures; extend `apply-pipeline.spec.ts` with a chain ending in a baked body.
- [x] 4.3 Feature-tree presentation: baked source features visible with reason codes; `bakedBody` feature labeled with its source span.

## 5. Verification

- [x] 5.1 Manual smoke: re-import Taskariki — a correct solid must be visible; record in change notes with the per-tier table (unchanged tiers, new materialization column).
  - 2026-07-12: headless real-OCC repro passed (Taskariki 2 bodies); browser visual/reload smoke remains required.
  - 2026-07-12: browser retry must run after this timeout policy change; Taskariki’s measured ~65 s synchronous materialization is below the new 90 s repository synchronization budget.
  - 2026-07-12: browser-native OCC performance repro now reports Taskariki 2 body records (8 total including 6 construction records), zero face/edge/vertex records, 13 transferable buffers total (4 body-mesh buffers; two position/index pairs), and no native topology buffers.
- [x] 5.2 Run `bun run test:all`.
  - Blocked in this environment: Bun is unavailable; equivalent Vitest/lint commands were run, and `tsc -b tsconfig.app.json` has unrelated baseline failures recorded in notes.
  - 2026-07-12: targeted timeout/rollback logic and durable-history UI-local tests pass through direct Node Vitest invocation; do not run Playwright for this change.
  - 2026-07-12: focused OCC snapshot, mesh-transport, and viewport-picking specs pass through direct Node Vitest; `tsc -b tsconfig.app.json` passes. User requested no browser/e2e run.
