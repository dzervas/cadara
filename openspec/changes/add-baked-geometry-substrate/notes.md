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
