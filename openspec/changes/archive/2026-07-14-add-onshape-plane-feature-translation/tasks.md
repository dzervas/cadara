## 1. Contract: explicit-frame plane mode

- [x] 1.1 Extend `PlaneFeatureParameters` in `src/contracts/modeling/schema.ts` with the `explicitFrame` mode carrying a `SketchPlaneFrame`; regenerate/extend the Typia runtime schema; keep `coplanar` untouched.
- [x] 1.2 Add a plain-TypeScript orthonormal right-handed frame invariant (shared helper) used at contract validation; reject degenerate frames with a structured diagnostic.
- [x] 1.3 Add `.spec.ts` accept/reject coverage for the new mode (logic lane, per `docs/testing.md`): valid frame accepted, non-unit/non-orthogonal/left-handed frames rejected, coplanar unchanged.

## 2. Kernel materialization

- [x] 2.1 Implement `explicitFrame` in `src/domain/modeling/occ/features/plane.ts`: create the durable construction target embedding the provided frame; reuse the existing construction-plane production path.
- [x] 2.2 Implement `explicitFrame` in `MockKernelAdapter` with equivalent semantics.
- [x] 2.3 Add commitSketch construction-support validation to `MockKernelAdapter` matching OCC's `requireLiveConstructionPlane` behavior; fix any fixtures that relied on phantom supports (fix fixtures, do not weaken the check).
- [x] 2.4 Add coverage: OCC plane explicit-frame spec beside existing plane feature specs (sketch committed on the created construction resolves); mock-kernel spec for explicit-frame planes and for rejecting unresolvable sketch supports.

## 3. Orchestrator: `constructionOf` deferred reference

- [x] 3.1 Add the `constructionOf` deferred kind to the import contract types and `ImportDeferredMaterializer` (`src/domain/import/orchestrator.ts`): record produced construction targets per ordered position (mirror `recordBodyOutput`), substitute into `CommitSketchRequest.plane.support` before apply.
- [x] 3.2 Extend ordered-action invariant validation: `constructionOf` must point backward at a `createFeature` action; reject forward/out-of-bounds/wrong-kind before any mutation.
- [x] 3.3 Wire the same recording/resolution into the kernel history probe (`src/domain/import/kernel-history-probe.ts`) so probed prefixes match real apply.
- [x] 3.4 Add `.spec.ts` coverage: happy path (plane feature → sketch on `constructionOf`), forward-reference rejection, producer-emitted-no-construction structured failure with atomic rollback.

## 4. Onshape provider: cPlane translation

- [x] 4.1 Plan recovered `cPlane` entries as `parametric` plane features: new feature-plan target kind for planes, explicit-frame definition from the captured planar signature (reuse `planeFromCapturedSignature` frame math, unit scaling included); add the recovery-source reason code(s) to `fidelity-planner.ts`.
- [x] 4.2 Emit the `plane` feature action in `buildPreparedActions` in history order with provenance labeling; record its ordered position for consumers.
- [x] 4.3 Rewire dependent sketches to `constructionOf` supports pointing at the translated plane; delete the `construction_import_captured_*` synthetic-id branch and the promotion-without-producer path in `activateCapturedFramePlanning`.
- [x] 4.4 Keep honest degradation: unrecoverable cPlanes stay `baked` and cascade to dependents; the probe-failure demotion loop remains as the safety net.
- [x] 4.5 Update provider/fidelity-planner `.spec.ts` fixtures: cPlane translated with reason code, unrecoverable cPlane bakes and cascades, no prepared sketch carries a support no action produces; extend `apply-pipeline.spec.ts` with plane → sketch → extrude chain.

## 5. Verification

- [x] 5.1 Manual smoke: import `9841e486906fa2ce62d74d8e.onshape-capture.json` on real OCC — "Incline" appears as a live plane feature, "Screen Outline" commits parametrically on it, import completes; record the per-tier table delta in change notes.
- [x] 5.2 Run `bun run test:all` (in the container: `podman exec cadara-agent-1 bun run test:all`); record any pre-existing failures separately.
