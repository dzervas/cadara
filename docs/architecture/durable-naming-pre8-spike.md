# Durable naming before OCCT 8: feasibility spike

## Decision

**Verdict: FEASIBLE, with medium-high implementation risk.** A pre-8.0 fix can use stable authored sketch source IDs as the semantic bridge between two executions of the same feature, and use the already-bound `BRepPrimAPI_MakePrism` history inside each execution to project those sources onto generated solid topology. The old and new feature stages can then classify each old public topology ID as having zero, one, or many successors before any downstream feature executes. This does not require nearest-geometry or traversal-order matching.

This is worth doing because the first useful slice needs no Wasm rebuild and directly removes the silent-wrong-remap release blocker. It is also a bounded stepping stone to BRepGraph if the semantic source-key/provenance contract is kept separate from the temporary JS/OCAF reconciliation machinery. Risk remains medium-high because Cadara currently retains neither per-feature stage bodies nor sketch-profile source subshapes, and unsupported profile/operation forms must invalidate conservatively rather than fall back to geometry identity.

## Problem restatement

The release gate in `src/domain/modeling/occ/topological-naming.spec.ts:1587-1638` authors a rectangular sketch and extrude, selects the vertical edge generated from the rectangle's bottom-right point, authors a downstream fillet, then replaces the rectangle with a triangle which removes that point and edge (`topological-naming.spec.ts:1595-1628`). The rebuilt prefix should report the old edge as deleted, missing, or ambiguous. It instead reports it live, so the expectation remains `test.fails`.

That result is unsafe even if the rebuilt solid looks valid. A durable topology reference may survive only when semantic lineage proves one successor; exact geometric reincidence, a stable traversal slot, or an OCAF selector attached only to the newly built body is not such proof. Enabling `supportsDurableTopologyNaming` now could therefore move an imported fillet, chamfer, shell, thicken, or sketch-on-face reference to unrelated topology, as recorded in `docs/architecture/onshape-topology-reference-resolution.md:194-212`.

## Code-path trace: where lineage is lost

1. The failing test replaces only `state.sketches`, retains the authored feature definitions, and asks `rebuildOccAuthoringState` to rebuild the base feature (`topological-naming.spec.ts:1618-1628`). The extrude's region reference still identifies the edited sketch/region.
2. `rebuildOccAuthoringState` creates a fresh execution state with `features: []` and only `state.baseBodies`; it carries `state.referenceState`, but not the body/topology state after each old feature (`src/domain/modeling/occ/authoring-state.ts:367-389`). It then re-executes features in order (`authoring-state.ts:391-406`). This is the precise cross-rebuild lineage gap: the previous base-extrude stage is no longer available when the edited base extrude executes.
3. Extrude resolves the current sketch and region and builds a completely fresh profile face (`src/domain/modeling/occ/features/extrude.ts:235-260`). `buildRegionProfileFace` builds OCC edges and a wire, but returns only `{ face, plane, normal }` (`src/domain/modeling/occ/sketch-profile.ts:876-1022`, `1024-1103`). The association from `SketchEntityId`/`SketchPointId` to profile edge/vertex has been discarded.
4. `buildExtrudeEndShape` creates a `BRepPrimAPI_MakePrism`, but returns only the final shape after optional draft (`src/domain/modeling/occ/features/extrude.ts:402-443`). Although the prism owns useful `Generated`, `FirstShape`, and `LastShape` history, it is not returned to feature execution. `buildExtrudeFeatureShape` similarly collapses all profile/end results to shapes (`extrude.ts:446-483`).
5. A `newBody` extrude goes through `applyBooleanPolicy`, which calls `trackNewBodyResults` and emits no history invalidations (`src/domain/modeling/occ/features/boolean-operations.ts:825-848`). `trackNewSolidBody` seeds a new naming state; it never sees the previous execution of this same feature (`src/domain/modeling/occ/topology.ts:878-894`). Operation-local reconciliation is therefore not entered. By contrast, mutating booleans call `reconcileReplacementSolidBody` with builder history (`boolean-operations.ts:870-912`; `topology.ts:1030-1080`).
6. The fresh body is converted into a new live-reference map. `createOccReferenceState` gives any newly live key precedence by deleting an older invalidation, then skips invalidation of any previous key present in the live map (`src/domain/modeling/occ/topology.ts:1263-1301`). `resolveOccReference` checks live records first (`topology.ts:1319-1343`). Thus a fresh public-ID coincidence is interpreted as liveness even though no old-stage-to-new-stage semantic relation was supplied.
7. OCAF/TNaming cannot repair the missing bridge. Naming is seeded on the fresh body (`src/domain/modeling/occ/topology-naming.ts:241-295`), while selector/history reconciliation only compares a supplied `previous` body with a replacement and its operation history (`topology-naming.ts:574-697`, `983-1099`). At the sketch-driven new-body stage, neither input exists.

`snapshot.ts` only presents the resulting IDs and reference records (`src/domain/modeling/occ/snapshot.ts:605-706`, `835-867`); it is downstream of the loss and is not a source of lineage.

## Feasible semantic-lineage design

Persist an internal, per-feature rebuild-stage record keyed by `(featureId, output body slot)`. A stage stores the tracked output body plus a provenance relation from semantic source keys to output subshapes/public IDs. For a sketch extrusion, source keys are authored identities and generation roles, for example:

- `sketch-point:<sketchId>:<pointId>:generated-side-edge`;
- `sketch-point:<sketchId>:<pointId>:first-vertex` / `last-vertex`;
- `sketch-entity:<sketchId>:<entityId>:generated-side-face`;
- `sketch-entity:<sketchId>:<entityId>:first-edge` / `last-edge`;
- `profile:<featureId>:<profile-slot>:first-face` / `last-face`.

During rebuild, execute the new stage while the old stage is still available. Compare exact source keys, not geometry. For each old topology ID, union the new shapes reached by all of its source keys: zero is deleted/missing, one preserves the old public ID, and many is ambiguous. Multiple old IDs claiming one successor are also ambiguous. Complete this reconciliation and update the reference state before executing the next feature. Existing operation-local OCC history then carries the reconciled IDs through downstream booleans, fillets, chamfers, and shells.

A throwaway `/tmp` experiment against the checked-in runtime confirmed the critical OCC behavior. With profile vertices constructed once per authored sketch point and reused by adjacent profile edges, a rectangular prism reported:

- each of four profile edges generated one distinct lateral face;
- each of four profile vertices generated one distinct vertical edge;
- `FirstShape(source)`/`LastShape(source)` identified all eight cap edges and all eight cap vertices;
- `FirstShape()`/`LastShape()` identified the two cap faces.

The 6 faces, 12 edges, and 8 vertices were therefore covered without geometric matching. The current profile builder constructs line edges from independent point values (`sketch-profile.ts:371-397`); the experiment also showed why shared source vertices are necessary, since wire canonicalization otherwise breaks most source-handle queries.

Stable IDs are not available for every generated/profile form. Sampled profile text, approximation-based curves, unsupported draft history, or a feature with no semantic source map must invalidate affected old topology as `occ-topology-unsupported-history`/missing. Conservative invalidation is compatible with durable naming; silent remapping is not.

## Current OCC API and native-surface audit

The required first-slice APIs are already in the custom build:

- `BRepBuilderAPI_MakeShape` is bound in `opencascade-recipe.yaml:24` and exposes `Generated`, `Modified`, and `IsDeleted` (`public/cadara-occ.d.ts:813-819`).
- `BRepPrimAPI_MakePrism` is bound at `opencascade-recipe.yaml:50` and exposes `Generated`, `IsDeleted`, and both whole-shape and source-shape `FirstShape`/`LastShape` calls (`public/cadara-occ.d.ts:1329-1338`).
- `BRepAlgoAPI_*`, `BRepTools_History`, and TNaming/OCAF are already bound at `opencascade-recipe.yaml:12-17`, `53`, and `78-100`. `BRepTools_History` exposes generated/modified/removed relations (`public/cadara-occ.d.ts:1424-1438`).
- The pre-8 native shim already serializes `IsDeleted`/`Modified`/`Generated` as zero/one/many history records (`occ-native-shims/cadara-native-topology-helpers.inc:678-782`) and native boolean transactions already request history (`occ-native-shims/cadara-execute-native-feature-transaction.inc:110-119`). Those APIs solve operation-local replacement, not the absent same-feature cross-rebuild bridge.

Runtime inspection also confirmed those methods on the loaded Wasm constructors. Therefore **K.2's first qualifying implementation does not require recipe changes, shim changes, regenerated `public/cadara-occ.*`, or a Wasm rebuild**. The smallest implementation should keep sketch IDs and source-key comparison in TypeScript and consume existing prism history before deleting builders.

If profiling later justifies batching profile/prism provenance, add one temporary native transaction that accepts caller-supplied opaque source keys and emits source-key-to-final-topology relations. That would touch `occ-native-shims/cadara-execute-native-feature-transaction.inc`, `opencascade-recipe.yaml`, `native-topology-payload.ts`, and regenerated Wasm assets. It is optional, not a prerequisite, and must carry the same deletion boundary as the existing pre-8 shim.

## Cheap partial improvement: honest deletion

A cheaper JS-only safety fix exists, but it is not durable naming. On rebuild, allocate fresh topology identity for re-created new-body stages (or quarantine colliding live keys) unless an explicit stage reconciliation authorizes an old ID. Previously live subtopology from a rebuilt stage would then remain invalidated as missing/unsupported-history, and downstream consumers would fail honestly instead of selecting a coincident fresh ID. This likely touches `authoring-state.ts`, `topology.ts`, and the feature-reference precondition path; it needs no Wasm rebuild.

Merely changing `resolveOccReference` to prefer an invalidation over a live key is insufficient: downstream feature executors currently resolve edge/face IDs directly from `OccTrackedBody` maps. The partial must prevent the stale public ID from being installed on the fresh body, or reject the feature before execution. This can change the release-blocker calculus from silent corruption to honest degradation, but it does **not** justify enabling `supportsDurableTopologyNaming` or ungating Wave S.

## Phase K.2 ordered implementation tasks

1. **Retain feature-stage naming state (JS/TypeScript; no native change).** Add an internal stage/provenance type (prefer a focused `src/domain/modeling/occ/topology-stage.ts`) and thread `previousFeatureStages`/current stages through `src/domain/modeling/occ/authoring-state.ts` and `src/domain/modeling/occ/features/shared.ts`. Store tracked output bodies and source-key relations by feature/output slot; do not expose OCC handles in authored contracts or snapshots. Verify at the exported rebuild seam that the old stage is available only to the matching feature and that reorder/suppression does not cross-associate stages.
2. **Emit sketch-profile source provenance (JS/TypeScript; no native change).** Change `src/domain/modeling/occ/sketch-profile.ts` to construct/reuse vertices by `SketchPointId`, retain profile edges by `SketchEntityId` (and projected reference key), and return a narrow provenance-bearing profile result. Unsupported sampled/approximated segments must be tagged unsupported, not assigned by wire traversal order. Verify line/arc/circle and projected-boundary source maps, including shared vertices and deleted source IDs.
3. **Project source provenance through prism generation (JS/TypeScript; no native change).** Refactor `src/domain/modeling/occ/features/extrude.ts` so each prism remains alive long enough to query `Generated` and source-specific/whole-shape `FirstShape`/`LastShape`; compose optional draft and boolean history where available. Include profile slot and end role in keys. Verify complete rectangle coverage, dimension-only one-successor mapping, rectangle-to-triangle zero-successor mapping, two-side/multi-profile disambiguation, and conservative unsupported draft behavior.
4. **Reconcile stages before downstream execution (JS/TypeScript; no native change).** In `src/domain/modeling/occ/topology-naming.ts`, `topology.ts`, and `authoring-state.ts`, add exact source-key zero/one/many classification, old-ID preservation only for one-to-one claims, explicit deleted/ambiguous/unsupported invalidations otherwise, and reference-state installation before the next feature. Feed reconciled topology into existing operation-local history. Verify that a downstream fillet receives either the proved old ID or an invalid-reference diagnostic before OCC execution.
5. **Close the collision fallback (JS/TypeScript; no native change).** In `src/domain/modeling/occ/topology.ts` and feature precondition resolution, prevent a fresh new-body public ID from resurrecting a previously live reference when no stage proof exists. Use fresh IDs or conservative invalidation; never compare geometry or traversal positions. Verify an exactly coincident delete-and-recreate remains invalid while a proved semantic successor remains live. This task is independently shippable as the honest-deletion partial.
6. **Broaden producer coverage conservatively (JS first; native extension only if evidence requires it).** Add equivalent source roles for revolve in `src/domain/modeling/occ/features/revolve.ts`; audit draft, sweep, loft, thicken, face-backed profiles, and multi-result paths. A producer without complete semantic/operation history must invalidate its affected prior stage. If a native batched provenance transaction is needed, extend the shim/recipe/payload files listed above, rebuild Wasm, and mark the addition for deletion at BRepGraph cutover. Verify every currently executable new-body producer either proves successors or emits unsupported-history—none may silently re-enumerate.
7. **Qualify and flip the gate (logic lane).** Update `src/domain/modeling/occ/topological-naming.spec.ts` at the OCC authoring rebuild/reference-resolution seam: remove `test.fails`, pin zero/one/many outcomes, add coincident delete/recreate and unsupported-producer cases, and retain dimension/reorder/suppression coverage. Only after all pass, set `OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming` in `src/domain/modeling/opencascade-kernel-seed.ts`, update the topology architecture docs, run `bunx vitest run src/domain/modeling/occ/topological-naming.spec.ts`, then `bun run test:all`.

## Blast radius, migration fit, and risk

Expected initial production blast radius is one new internal module plus `authoring-state.ts`, `features/shared.ts`, `sketch-profile.ts`, `features/extrude.ts`, `topology-naming.ts`, and `topology.ts`; qualification also changes the existing spec, capability flag, and docs. No persistence schema change is needed because stage handles are rebuild-session state. OCC object lifetime and disposal need explicit review because retained stage shapes/naming labels cross feature executions.

This does not conflict with `openspec/changes/modernize-occ-kernel-topology`. The reusable part is the semantic source-key relation and the rule that only kernel/source history can authorize successors. BRepGraph can later own output IDs and history while consuming the same authored source keys. The JS-held `TopoDS` stage snapshots, OCAF labels, and pre-8 reconciliation loops remain temporary and should be deleted in migration tasks 5.2-5.4 (`openspec/changes/modernize-occ-kernel-topology/tasks.md:32-37`).

Risk is **medium-high**: the release-gate extrusion is directly supported by demonstrated APIs, but complete capability qualification requires conservative handling of every executable topology producer, multi-output claims, memory lifetime, suppression/reorder, and operation-history composition. Wave S must remain gated until all K.2 qualification tasks pass and the capability flag flips.