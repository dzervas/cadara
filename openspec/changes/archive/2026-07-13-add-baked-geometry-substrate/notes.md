# Implementation Notes

## 2026-07-10 STEP reader gate

Current `opencascade-recipe.yaml` binds `STEPControl_Writer`, `STEPControl_Controller`, and STEP model type exports, but does **not** bind `STEPControl_Reader`. Adding exact STEP baking is not just a one-line provider toggle: it requires extending the custom OCC wasm recipe, rebuilding/verifying the generated bindings, and then adding a STEP asset validation/materialization path distinct from the v1 tessellation path.

Decision for this change slice: defer `step` baked geometry support. Keep v1 on `baked-mesh`; unsupported `step` baking continues to fail with a structured unsupported-format capability error. Revisit STEP reader support as a follow-up with binary-size measurement after the current custom build is otherwise green.

## 2026-07-10 Verification status

`bun` is not available in the current agent environment and no browser is present, so `bun run test:all` and the in-app Taskariki manual smoke (task 5.1) could not be executed here and remain open for a human/browser run.

Affected logic lanes were validated with the repo-local vitest binary instead:

- `src/contracts/modeling` + `src/domain/import` — 56 passed
- mock/OCC baked-body specs, `mock-kernel-adapter`, OCC `snapshot`/`features` — 9 passed
- modeling-service + document-repository specs — passed
- OCC worker-client + worker-backed repository + modeling-service boundary — passed
- `test/static` guards — 23 passed
- `tsc --noEmit` (tsconfig.app.json) — clean
- eslint on changed files — clean

Per-tier fidelity table (to be confirmed during the manual Taskariki smoke):

| Tier | Behavior before | Behavior after | Materialization |
| --- | --- | --- | --- |
| parametric | committed live features | unchanged | kernel rebuild |
| baked | suppressed placeholder, no solid | studio ground-truth emitted as one `bakedBody` | faceted OCC solid via sewn mesh |
| geometry-only | listed with reason codes | unchanged | none |

## 2026-07-11 Taskariki apply repro + sketch plane placement

Repro `tmp-repro/baked-apply.spec.ts` against the real bundle
`9841e486906fa2ce62d74d8e.onshape-capture.json` (studio: Part Studio 1, 41 features):

- Fidelity: **8 parametric, 33 baked, 0 geometry-only** (3 variables + 5 sketches parametric; whole-studio bake for the rest).
- The repro rolls back with `baked-body-assetMissing` **by construction**: it builds `createImportCapabilities` (default memory store) and `MockKernelAdapter` (no resolver) independently, so the baked bytes and the kernel resolver do not share a store. Production shares them via `getBrowserGeometryAssetStore()` + `createBrowserGeometryAssetResolver()`, so the commit should succeed. The error message is now human-readable (`describeUnknownError`), not `[object Object]`.

Sketch plane placement (from the bundle's captured `resolvedReferences`):

- **Screen Outline** → plane ref `JGC`, captured planar face, normal `[0, -0.866, 0.5]`, origin `[0, 0.025, 0.043]` (inclined ~30°).
- **Sketch 2** → plane ref `JI+`, same normal `[0, -0.866, 0.5]`, origin `[-0.0075, 0.055, 0.096]` (a parallel inclined plane ~60 mm away).
- Both are promoted to parametric by `activateCapturedFramePlanning` (`sketch-on-captured-frame`), which runs before the probe and builds the plane **directly from the captured face origin+normal** — not by matching rebuilt topology. So Screen Outline sits on the inclined plane by construction, and the two parallel inclined sketches are distinguished by origin. No coincidental-match risk in the captured-frame path.

Open verification (needs browser, task 5.1): on a successful commit, visually confirm Screen Outline renders on the inclined plane. The false-unique-match tolerance concern applies only to the **probe** matcher (`matchSignature` against rebuilt topology) for sketches that remain baked-then-probe-promoted; if any probe-placed sketch lands on a coincidentally-matching face, file a matcher-tolerance bug against the OCC probe change (not this substrate).

## 2026-07-11 Option B: self-describing document, registry deleted

Fixed the architectural defect where kernel asset resolution depended on a session-scoped module-level registry (`bakedGeometryAssetRecords` in the orchestrator), which made reload broken by construction and left production unwired (no caller passed a shared store into imports).

- **Contract:** `BakedBodyFeatureParameters` now carries `hash` and `byteLength` alongside `assetId`/`format`, i.e. a complete `BakedGeometryAssetReference` (new type + `createGeometryAssetRecordFromReference`/`getGeometryAssetMediaType` helpers in `geometry-assets.ts`). `ImportCapabilities.bakeGeometry` returns the reference instead of a bare id.
- **Resolver seam:** `GeometryAssetResolver.resolveGeometryAsset` now takes the reference (threaded through `contracts/modeling/adapter.ts`, the OCC worker request/response pair, `worker.ts`/`worker-client.ts`, `MockKernelAdapter`, `opencascade-kernel-adapter` pre-resolution, and `modeling-service`). Resolution is a pure `store.get(record)`.
- **Registry deleted:** `bakedGeometryAssetRecords` + `getBakedGeometryAssetRecord` removed; no session-global asset state remains.
- **Composition:** one `createGeometryAssetComposition(store)` helper yields BOTH the import baking store binding and the kernel resolver; `getBrowserGeometryAssetComposition()` memoizes it so `use-workbench-document-owner` (writer store) and `browser-kernel-runtime` (reader resolver) share one instance. The Onshape provider emits the full reference in the `bakedBody` definition.
- **Tests:** composition-seam specs obtain both ends from the helper (`apply-pipeline.spec.ts` baked-body case + `browser-geometry-asset-store.spec.ts`); the reopened-document OCC spec now proves an honest reload from a persisted store with a fresh adapter and no shared module state.
- **Real bundle:** `tmp-repro/baked-apply.spec.ts` (wired via the composition helper) against `9841e486906fa2ce62d74d8e.onshape-capture.json` ends with `created: features=1 sketches=5` and no `import-apply-failed` (33 baked features materialized into one `bakedBody`).

Validated locally with the repo-local vitest binary (`src/domain/import`, `src/contracts/modeling`, `src/domain/modeling`, `src/infrastructure`, `src/domain/modeling/occ`, `test/static` — all green), `tsc -b tsconfig.app.json` clean, and eslint clean on `src/domain src/contracts src/infrastructure src/workbench`. Browser smoke + reload check and Playwright e2e remain for a human/browser run.

## 2026-07-12 OCC materialization and post-import snapshot reconciliation

- The inherited mesh implementation merged components through any coincident vertex and accepted an unchecked `MakeSolid` result. Taskariki’s provider bake has 27,114 triangles with coincident edge use belonging to two components; the old merge made one non-manifold candidate. The corrected edge-pair partition produces two closed OCC bodies (20,022 and 7,092 faces). Invalid/open/orientation-inconsistent components now produce the existing structured `baked-body-materializationFailed` diagnostic rather than a partial body.
- Real-OCC throwaway repros under gitignored `tmp-repro/` invoked the provider, persisted its baked asset, and executed `bakedBody` against `getDefaultOpenCascadeInstance`: HackerBoard: 464 triangles → 1 body / 464 faces; Taskariki: 27,114 triangles → 2 bodies / 20,022 and 7,092 faces; both had zero error diagnostics.
- The import owner now returns the accepted post-commit snapshot without dispatching it while the editor is still importing. `use-workbench-part-import` closes the import event first, then dispatches that exact accepted snapshot, so the event loop’s document state and viewport render records reconcile in order without a component refresh.
- Browser smoke/reload remains open. `bun` is unavailable. The requested `tsc -b tsconfig.app.json` currently fails on unrelated pre-existing type errors in `core/feature-authoring/features/{revolve,shell}.ts`, `domain/import/kernel-history-probe.ts`, and instrumented repository/service/worker wrappers.

## 2026-07-12 authoritative baked-mesh component partition

- Fixed the high-correctness defect in baked-mesh v1: the provider no longer emits an unpartitioned vertex/index soup. It writes deterministic, contiguous `components` ranges directly from the captured Onshape `tessellatedFaces.bodies[]` grouping; runtime validation requires full ordered coverage and unique non-empty source keys.
- OCC now iterates declared ranges only. It does not call geometry-based component splitting. Shared-edge pairing is retained solely to validate closure/orientation and that one declared component is one connected shell. A source body that contains disjoint solids but lacks explicit per-solid capture groups fails with `baked-body-materializationFailed`, rather than inventing identities.
- Compatibility decision: legacy `baked-mesh-geometry/v1alpha1` payloads without `components` are exactly one component. They succeed only if the entire mesh is a single connected, closed, orientable two-manifold shell; multiple disconnected shells fail loudly. This is intentionally conservative and documented in the baked-body specification.
- Focused logic/OCC suite: 23 tests passed (runtime schema, Onshape provider, OCC baked body), including coincident source bodies remaining two bodies and a disconnected declared group producing the structured diagnostic. Real bundles under gitignored `tmp-repro/` passed against real OCC: HackerBoard 464 triangles → 1 body / 464 faces; Taskariki 27,114 triangles → 2 bodies / 20,022 and 7,092 faces; zero error diagnostics. No proprietary bundle data was changed or committed.
- The same repro was rerun against `public/cadara-occ.js` + `public/cadara-occ.wasm` (the browser-native OCC build): the identical HackerBoard and Taskariki counts passed with zero error diagnostics. The checked-in browser visual/reload smoke remains open.
- Validation: `tsc -b tsconfig.app.json` passed; changed-file eslint passed; logic 352/352, UI 120/120, and static 23/23 passed. The repository-wide eslint command remains blocked by a pre-existing unused import in gitignored `tmp-repro/hackerboard-live-vs-restored.spec.ts`. Playwright attempted 52 e2e tests but every test failed before application execution with `TypeError: Cannot add property _defaultLaunchOptions, object is not extensible`; no application assertion ran.


## 2026-07-12 explicit final-studio checkpoint replacement

HackerBoard's rotated duplicate was traced to `executeBakedBodyFeature` appending the authoritative final tessellation to `context.bodies` after earlier imported parametric bodies. The correction is an explicit contract, not a geometric heuristic: `bakedBody.replacement` is `append` or an exact durable `replaceBodies` list. The Onshape final-studio provider emits the import-deferred `replaceBodyOutputs` scope for all preceding feature actions in its ordered import span; apply materializes returned body IDs and the checkpoint replaces only that resolved list. Feature/history entries remain intact, while later features see only the baked body set plus unrelated bodies.

Focused logic/OCC validation passed: 34 tests across runtime schema, import validation/apply pipeline, Onshape provider, mock, OCC, and composition seam; `tsc -b tsconfig.app.json` passed. Real OCC repros also passed: the HackerBoard whole apply pipeline retained its parametric extrude/history but rendered exactly one baked body; direct provider-bake materialization counted HackerBoard 1 body / 464 faces and Taskariki 2 bodies / 20,022 and 7,092 faces, with no error diagnostics.


## 2026-07-12 Taskariki durable-undo timeout diagnosis

- The OCC worker client (`src/domain/modeling/occ/worker-client.ts`) has no request timeout: requests remain pending until a worker `invoked`/`failure` response or client disposal. The editor event loop likewise awaits effects without a deadline. The measured Taskariki materialization (27,114 triangles, two bodies) therefore is not cancelled at the worker boundary.
- The real timeout was the durable-history repository-change waiter: `createDurableHistoryService` used a fixed 2,000 ms deadline while the repository notification is emitted only after the receiving modeling service rebuilds the authored document. A rollback undo starts that rebuild; Taskariki’s roughly 65-second synchronous OCC bake consequently exceeded the waiter and replaced the original import apply error in the hook.
- Policy: `DEFAULT_REPOSITORY_SYNCHRONIZATION_TIMEOUT_MS` is now 90,000 ms, independently injectable for tests. This is deliberately a repository-rebuild synchronization budget, not an OCC client request timeout; worker errors and disposal remain observable without adding a kernel deadline.
- Import application now retains `import-apply-failed` as the first diagnostic and appends `import-rollback-failed` with the rollback cause. Any failed import with committed work refreshes the workbench basis; reconciliation failure is appended as `import-reconciliation-failed` rather than hiding the original causes.
- Focused checks: the delayed-worker protocol client test proves a late response completes; the durable-history test compresses a delayed rebuild through injected timeout configuration; the import pipeline test proves both structured causes survive. `tsc -b tsconfig.app.json` and changed-file eslint pass. The broader selected import pipeline currently has one separate in-progress baked-checkpoint assertion failure (two bodies instead of one); it is outside the timeout/rollback seam. Browser visual/reload smoke remains required.

## 2026-07-12 baked body-only snapshot measurement

`bakedBody` now sets `topologyPresentation: "bodyOnlyMesh"` only at its OCC materialization seam. The OCC faceted shape and mesh fallback remain authoritative for STEP/export and body operations; snapshots deliberately publish no face/edge/vertex IDs, references, signatures, native topology payload, or subtopology render records. One body-targeted mesh record is emitted per source component, so face/edge picking is not advertised.

Browser-native `tmp-repro/taskariki-snapshot-performance.spec.ts` (custom `public/cadara-occ.js/.wasm`) results:

| Bundle | triangles | components | materialization | native snapshot export | snapshot | records | refs | transfer buffers / bytes | JSON-equivalent snapshot | RSS / V8 heap delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| HackerBoard | 464 | 1 | 329 ms | 0 ms | 8 ms | 7 (1 body + 6 construction) | 5 | 11 / 22,632 | 97,805 B | +6,443,008 / +6,462,776 B |
| Taskariki | 27,114 | 2 | 15,756 ms | 0 ms | 16 ms | 8 (2 body + 6 construction) | 6 | 13 / 1,301,832 | 5,201,384 B | +62,050,304 / +125,804,304 B |

Taskariki therefore has exactly **2 body records**, zero baked face/edge/vertex records, and four body mesh transfer buffers (positions + indices for each component); the remaining nine transfer buffers are existing construction render records. This replaces the measured 81,314 topology/render references, 54,237 buffers, ~277 MB snapshot object, ~66 s native snapshot export, and ~2.95 GB RSS/~1.83 GB V8 growth. The JSON-equivalent snapshot still expands mesh coordinate arrays by contract; transport uses contiguous typed arrays.

Browser retry: start the app with the project’s normal browser runtime, import the proprietary Taskariki capture, wait for the baked materialization, confirm exactly two selectable body meshes are visible, confirm face/edge selection is unavailable, reload and confirm both bodies rebuild, then export STEP to verify the retained OCC shapes. Do not run Playwright/e2e for this change.


Validation: focused specs passed; full non-E2E Node Vitest passed (**355 logic**, **121 UI**, **24 static**); `node node_modules/typescript/bin/tsc -b tsconfig.app.json --pretty false` passed; changed-file ESLint passed. Repository-wide ESLint is blocked only by pre-existing unused imports in gitignored `tmp-repro/baked-import-real-occ.spec.ts` and `tmp-repro/hackerboard-live-vs-restored.spec.ts`. Bun is unavailable, so `bun run test:all` could not be invoked; browser/E2E was intentionally not run.
