# Add Onshape Plane Feature Translation

## Why

Onshape `cPlane` features are on the always-bake list, so every construction plane — and, without workarounds, every sketch drawn on one — loses parametricity on import. The existing workaround (`activateCapturedFramePlanning`) promotes such sketches by fabricating a `construction_import_captured_*` support id that no feature ever creates, violating the sketch-plane contract ("the target must resolve") and failing hard on the real OCC kernel (measured: the 9841e486 capture aborts with `Construction plane construction_import_captured_JGC does not resolve`). The original `add-onshape-import-provider` spike already mapped `cPlane` → cadara's `plane` feature; this change implements that mapping so imported construction planes are real, live, editable features and dependent sketches reference them legitimately.

## What Changes

- Translate Onshape `cPlane` features into cadara `plane` features at the parametric tier instead of baking them, when the plane's geometry can be recovered (captured reference signature, offset parameters, or probe-rebuilt topology).
- Extend the plane feature contract with an **explicit-frame creation mode** (`mode: "explicitFrame"` carrying a full `SketchPlaneFrame`) so planes whose Onshape parents cannot be translated parametrically can still be created as standalone datum planes from captured world-space geometry. The existing `coplanar` mode is unchanged.
- Add a **`constructionOf` deferred reference** to the import prepared-action contract: a sketch commit (or other consumer) may reference the construction plane produced by an earlier `createFeature` action in the ordered sequence, resolved by the orchestrator at apply time — same pattern as the existing `sketchIdOf`/`bodyOf`/`regionOf` deferred kinds.
- Replace the captured-frame synthetic-support promotion: sketches on translated planes emit a `constructionOf` deferred support pointing at the created plane feature; the fabricated `construction_import_captured_*` ids are removed.
- Record honest fidelity outcomes: a `cPlane` that translates keeps tier `parametric` with a reason code naming the recovered source (`plane-from-captured-frame`, `plane-from-offset`, …); one that cannot stays `baked` with the existing degradation reporting, and its dependent sketches degrade with it (no phantom supports ever ship).

Out of scope: translating other history-consuming feature kinds (chamfer, shell, transform, split, boolean, delete — separate changes), capture v2 per-history-point resolution (lands independently and improves this change's hit rate), mesh→B-rep reconstruction.

## Capabilities

### Modified Capabilities

- `onshape-import-provider`: `cPlane` features translate to parametric `plane` features; dependent sketches reference translated planes through deferred construction references; captured-frame promotion no longer fabricates unresolvable supports.
- `import-provider-contract`: the deferred-reference requirement gains a `constructionOf` kind (construction id produced by an earlier feature action), with the same validation/rejection semantics as existing deferred kinds.
- `durable-modeling-contract`: `PlaneFeatureParameters` gains the `explicitFrame` mode alongside `coplanar`; explicit typed references remain required everywhere else.
- `occ-basic-feature-operations`: OCC-backed plane features accept the explicit-frame mode and create durable construction planes from a provided world-space frame.

## Impact

- Affected code: `src/contracts/modeling/schema.ts` (+ runtime schema/Typia validators) for the plane mode; `src/domain/modeling/occ/features/plane.ts` and `src/domain/modeling/mock-kernel-adapter.ts` for explicit-frame materialization; `src/domain/import/orchestrator.ts` + `src/domain/import/kernel-history-probe.ts` for `constructionOf` resolution and output recording; `src/domain/import/onshape/provider.ts` + `fidelity-planner.ts` for cPlane translation and removal of `planeFromCapturedSignature`'s synthetic support.
- Dependency/order: independent of `add-baked-geometry-substrate` (bake stays the fallback tier) and of capture v2, but capture v2 raises the fraction of cPlanes whose parent references resolve. Supersedes the captured-frame promotion path from `relax-import-bake-cascade` (and the probe-failure demotion hotfix layered on it).
- Testing impact: logic lane — contract accept/reject for the new plane mode, orchestrator deferred-`constructionOf` resolution (happy/forward-reference/missing-output), provider fixture cases (cPlane translated, cPlane unrecoverable → baked cascade), OCC plane explicit-frame spec beside existing plane feature specs, apply-pipeline case ending in a sketch on a translated plane.
