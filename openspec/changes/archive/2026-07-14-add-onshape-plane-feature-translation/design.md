# Design: Onshape Plane Feature Translation

## Context

Onshape `cPlane` features are always baked (`fidelity-planner.ts` `needs-history-probe` list). To keep sketches on those planes parametric, `relax-import-bake-cascade` added `activateCapturedFramePlanning`, which builds a `SketchPlaneDefinition` from the captured face signature but fabricates its support ref (`construction_import_captured_<deterministicId>`). No prepared action creates that construction, violating `src/contracts/shared/sketch-plane.ts` ("the target must resolve to one explicit planar construction or face"). The MockKernelAdapter does not validate sketch supports, so the defect was invisible in the logic lane; real OCC (`requireLiveConstructionPlane`) rejects the commit and the whole import rolls back after a full ~1-minute replay. A hotfix demotes those plans when the OCC history probe fails, which restores honesty but loses fidelity: the sketch bakes even though its plane geometry is fully known.

The right shape was already in the original import spike: `cPlane` → cadara `plane` feature. What is missing is (1) a plane-feature mode that can be driven from captured world-space geometry, (2) a way for a later sketch commit to reference the construction id a plane feature will produce at apply time, and (3) provider planning that emits both.

## Goals / Non-Goals

**Goals:**
- Imported Onshape construction planes become real, live `plane` features in the feature tree.
- Sketches on those planes commit parametrically on the real OCC kernel with contract-legal supports.
- Every emitted sketch support resolves; the phantom-id path is deleted.
- Unrecoverable planes degrade honestly through the existing bake cascade.

**Non-Goals:**
- Parametric translation of other baked feature kinds (chamfer, shell, transform, split, boolean, delete).
- Reproducing Onshape's full cPlane parameterization (offset/angle/mid-plane variants may translate opportunistically; the explicit frame is the guaranteed floor).
- Capture v2 history-point resolution (independent change; improves recovery rate here).
- Editable parametric linkage between the created plane and its Onshape parent reference (the explicit frame is a snapshot, and the feature says so via provenance labeling).

## Decisions

### D1: Explicit-frame plane mode over offset-composition
Extend `PlaneFeatureParameters` with `mode: "explicitFrame"` carrying a `SketchPlaneFrame` (reuse the existing shared frame type — it already encodes origin/axes/units/handedness and has validation precedent). Alternative considered: compose captured planes from `coplanar` + future offset/angle modes relative to base datums. Rejected: it cannot represent arbitrary captured frames without a chain of synthetic intermediate features, and the contract comment in `schema.ts` explicitly reserved room for additional modes. Typia validation covers structure; orthonormality/handedness checks live in a small plain-TypeScript domain invariant (per project validation policy).

### D2: `constructionOf` deferred reference, orchestrator-resolved
Add a `constructionOf(actionIndex)` deferred kind next to `sketchIdOf`/`bodyOf`/`regionOf` in the import orchestrator and `ImportDeferredMaterializer`, usable in `CommitSketchRequest.plane.support`. The producing `createFeature` application records its produced construction target (from `producedTargets`/`changedTargets`) into the output records, mirroring `recordBodyOutput`. The kernel history probe (`kernel-history-probe.ts`) resolves it identically so probed prefixes and the real apply see the same requests. Alternative considered: pre-allocating deterministic construction ids so the provider can reference them directly. Rejected: id allocation is a kernel concern; guessing ids re-creates the phantom-support class of bug.

### D3: Provider plans a plane feature per recovered cPlane
`fidelity-planner`/provider changes: a `cPlane` whose geometry is recoverable (captured planar signature today; offset parameters opportunistically) plans `parametric` with target kind `plane` and an explicit-frame definition; `buildPreparedActions` emits the `plane` feature action in history order and records its ordered position. Dependent sketches keep their existing frame math but swap the fabricated support for `constructionOf` pointing at that position. `planeFromCapturedSignature`'s synthetic-id branch and `activateCapturedFramePlanning`'s promotion-without-producer are deleted. The probe-failure demotion loop (hotfix) remains as the safety net for any remaining unresolvable promotion.

### D4: Mock kernel validates sketch supports
The mock adapter gains the same "construction support must resolve" check OCC enforces (it already has `hasConstructionTarget` for mirror). This is what would have caught the original bug in the logic lane and is required for the new orchestrator specs to be meaningful.

## Risks / Trade-offs

- [Explicit frame is a snapshot, not a parametric link] → The plane feature carries import provenance in its label/definition; re-import refresh replaces it wholesale. Documented in the fidelity report reason code.
- [Captured signatures are final-state only in capture v1] → Planes defined by mid-history faces stay unrecoverable until capture v2; the bake cascade covers them. Recovery rate is reported per import so the v2 delta is measurable.
- [Frame orthonormality tolerance] → Captured normals/xDirections come from Onshape at double precision but unit scaling already bit once (probe scaling helper exists); validate after normalization and reject loudly rather than silently re-orthogonalizing.
- [Deferred-kind proliferation] → `constructionOf` follows the exact existing pattern (record outputs by ordered position, substitute pre-apply, structured resolution failures); no new machinery.

## Migration Plan

No persisted-document migration: `explicitFrame` is additive to the feature contract, and existing documents contain no `construction_import_captured_*` supports (imports carrying them always failed on OCC and rolled back; mock-lane documents are test-only). The provider change supersedes the captured-frame promotion path; the probe demotion hotfix stays as a fallback and its reason code keeps reporting when it fires.

## Open Questions

- Should offset-style cPlanes (plane + distance) translate to a future `offset` plane mode instead of an explicit frame, to preserve editability? Proposal treats it as opportunistic; decide during implementation once fixture coverage shows how many cPlanes are plain offsets.
- Does the feature editor need a read-only form for `explicitFrame` planes in this change, or is the generic summary form sufficient? Default: generic summary (matches baked-feature presentation precedent).
