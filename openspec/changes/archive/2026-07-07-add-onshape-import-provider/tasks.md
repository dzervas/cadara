## 1. Generic Contract Extensions

- [x] 1.1 Add the ordered action sequence to `ImportPreparedActions` in `src/contracts/import/actions.ts` (refs across kind arrays, Typia validation, reject omissions/duplicates).
- [x] 1.2 Implement ordered application in `src/domain/import/orchestrator.ts` on the single revision chain, preserving atomic failure; grouped fallback unchanged.
- [x] 1.3 Add the history evaluation probe to `ImportCapabilities` (`src/contracts/import/capabilities.ts`): input sequence, per-step topology signatures, structured step diagnostics, explicit absence detection.
- [ ] ~~1.4 Implement the probe on the existing kernel worker path~~ **MOVED** to change `add-kernel-topology-signatures` (scope amendment below); this change ships with the probe explicitly absent on all platforms.
- [x] 1.5 Add `.spec.ts` coverage (logic lane, per `docs/testing.md`): ordered application incl. invalid sequences, grouped fallback regression for existing providers, probe contract shape against a hand-built mock probe (no kernel implementation).

## 2. Fixtures and Translation Tables

- [x] 2.0 Assemble fixture capture bundles offline and deterministically by running the capture pipeline (`src/cli/commands/onshape-capture/`) against its checked-in fixture transcript (no network); expose as a test helper or checked-in artifact for all fixture-driven tests below. (`capture-bundle-fixture.ts`)
- [x] 2.1 Implement the bundle reader: envelope validation reuse, narrow Typia validation of consumed Onshape payload shapes, unknown-shape diagnostics.
- [x] 2.2 Implement the feature classification + reason codes (probe-less scope): sketch/variable → parametric, all topology-dependent solids (extrude, chamfer, shell, cPlane, transform, splitPart, booleanBodies, deleteBodies, …) → `baked` with reason codes; custom FeatureScript types → `custom-feature`. NOTE: parametric solid parameter-mapping tables (extent/boolean) are deferred with the probe (they are not emittable probe-less).
- [~] 2.3 Sketch translator: entities (line/circle/arc/point) + construction flags + solved-geometry parsing (real `BTSketchCurveSegmentInfo`/`BTSketchPointInfo` `position3d`, projected onto the datum plane, meters→mm) DONE, contract-validated, and verified end-to-end with the **real** constraint solver. Constraint/derivation translation is **deferred** and the spec delta is amended accordingly (honest); carried-over relationships are a fast-follow.
- [x] 2.4 Implement the expression/variable translator: unit normalization, `#name` binding, literal fallback with diagnostics; `assignVariable` → document variables.
- [x] 2.5 Add fixture-driven `.spec.ts` coverage for 2.1–2.4 using the assembled fixture bundles from 2.0.

## 3. Reference Resolution and Fidelity Planning (probe-less v1)

- [x] 3.1 Implement capture-side signature interpretation: default-plane signatures → cadara canonical planes (XY/YZ/XZ); capture-side `unresolved` records → baked passthrough. NOTE: sketch-region 2D matching is scaffolded via the region concept but not wired (extrude regions stay baked probe-less); default-plane resolution is the shipped probe-free path.
- [x] 3.2 Implement the fidelity planner in probe-absent mode (the implemented path of the spec's "Probe unavailable" scenario): tier assignment and degradation reason codes, capability reason code for topological references requiring the probe, baked-tier v1 semantics (final-body bake + downstream suppression).
- [x] 3.3 Implement the probe-present matcher (type + defining-data + tolerance ranking, unique/ambiguous/no-match) against the mock probe only, so `add-kernel-topology-signatures` flips it on without provider changes.
- [x] 3.4 Ground-truth deviation verification: report as explicitly unavailable in review while the sandboxed rebuild capability is absent; comparison logic implemented against a mock sample for activation later.
- [x] 3.5 Add `.spec.ts` coverage: plane resolution, capability degradation matrix, mock-probe matcher outcomes (incl. symmetric-geometry ambiguity), unavailable-verification reporting.

## 4. Provider Assembly

- [x] 4.1 Implement review/selections/form-schema: studio selection, per-feature fidelity report with demotion controls, verification status (generic form field types only).
- [~] 4.2 Prepare: ordered action emission in history order + local-file binding with capture provenance + honest per-tier fidelity summary DONE. Baked-tier **materialization deferred by amendment 3** — no authored feature kind instantiates a geometry asset as a body (OCC executors are extrude/revolve/sweep/loft/thicken/chamfer/…; `bakeGeometry` returns an asset id nothing consumes, and `ImportPreparedActions` has no place-baked-body action). The studio-bake need is reported as an explicit `onshape-bake-unavailable` diagnostic rather than fabricating geometry. Baked-tier spec scenarios (plan marks baked + honest per-tier report, no degraded feature shown as parametric) are satisfied.
- [x] 4.3 Register the provider in `builtin-provider-composition.ts` and its extension in the accepted file types.
- [x] 4.4 Add `.spec.ts` coverage: end-to-end provider pipeline against fixture bundles via scoped registry composition (review → selections → prepare → ordered actions). Includes `apply-pipeline.spec.ts` — a **seam test that applies prepared actions through the real `createModelingService(new MockKernelAdapter())`**, proving the commit path (this caught the null-solver-correlation defect that a review→prepare-only test missed).

## 5. Verification

- [x] 5.1 Manual smoke: fixture bundle smoke-imported through the full provider pipeline in `provider.spec.ts`; both **real** bundles imported successfully in-app by the maintainer (2026-07-06) — variables and parametric sketches live with correct solved geometry, remaining features suppressed with reason codes, atomic rollback verified during the failure iterations.
- [x] 5.2 Record per-tier counts in the change notes (`notes/tier-baseline.md`): fixture baseline (Mounts 2 parametric / 1 baked; Empty 0/0) and real-bundle baseline recorded (HackerBoard 5/5/0 of 10; Taskariki 6/35/0 of 41, with reason-code breakdown). This is the comparison baseline for the fast-follow changes.
- [ ] 5.3 Follow-up task (not blocking): e2e flow — import fixture bundle, edit a dimension, rebuild.
- [x] 5.4 Run `bun run test:all` — logic lane (304 tests), static guards (23), lint, and `tsc` typecheck pass in-agent; `test:e2e` (Playwright) confirmed passing by the maintainer.

## Post-review fixes (2026-07-06)

- **Provider owns solver correlation ids** — `prepare()` now emits `request_import_<featureId>` correlation ids per sketch commit (contract: "Editor- or orchestrator-owned correlation IDs") instead of `null`, so committed import sketches project/solve/derive-regions through the real kernel path. Regression-guarded by `apply-pipeline.spec.ts`.
- **assignVariable review label** — the fidelity report now labels variable features by their authored `name` parameter rather than the generic feature name.
- **Standalone bug: import error propagation** — `use-workbench-part-import.ts` replaced the `instanceof Error` guards in both catch sites with `describeImportError`, which walks the AppError message/cause chain so import failures surface their real cause in the UI instead of a generic "Import failed."

## Post-review fixes round 2 (2026-07-06, real-solver findings)

The seam test was promoted to the **real** `SketchConstraintSolverAdapter` (pure TS), which surfaced defects the mock solver masked:

- **Real solved-sketch geometry is now parsed** — the reader/translator were built against the fixture's simplified `geomEntities` shape and dropped all geometry, committing empty sketches. They now parse the real Onshape `entities` payload (`BTSketchCurveSegmentInfo`/`BTSketchPointInfo`, `position3d`, `startPointId`/`endPointId`, `radius`), project world positions onto the target datum plane, and convert meters→mm. The fixture transcript was updated to the real shape (a closed circle) and `apply-pipeline.spec.ts` now asserts the circle survives translation+projection and commits through the real solver.
- **Import rollback (atomicity)** — `applyImportPreparedActions` no longer throws on adapter rejection; it stops, returns `appliedOperationCount`/`rolledBack`, and invokes an injected `rollback` callback so no partial import is committed. The workbench wires that callback to `durableHistory.undo` (the only revert that also removes document variables) and reconciles the snapshot on failure via `replaceActiveDocumentBasis`. Guarded by a new orchestrator logic test.
- **Expression angle units + literal recovery** — the translator now normalizes angle units (`30 deg` → `30`) alongside length, and its fallback recovers the literal magnitude from the expression **string** (never the captured `BTMParameterQuantity.value`, which the spike showed can be zero).

## Scope Amendment (2026-07-06)

Implementation surfaced two constraints; per the spec's own degradation contract, the change is rescoped rather than blocked:

1. **Probe implementation moved out** — no kernel signature-extraction path exists yet (`BodyTopologySnapshotRecord` exposes ids without geometry). The probe *contract* (1.3) stays here; the *implementation* moves to the new change `add-kernel-topology-signatures`, which builds signature extraction over the native exact-B-rep payload path. This change ships the spec's "Probe unavailable" scenario as the implemented v1 path — features needing mid-history topological resolution plan as `baked` with a capability reason code; ground-truth deviation verification reports as explicitly unavailable (delta spec amended accordingly).

3. **Baked-tier materialization deferred** — the geometry-asset substrate exists for `.cadara` native payloads and linked-document reuse, but there is no authored feature kind that instantiates a baked mesh/STEP asset as a body, `bakeGeometry` is an unimplemented capability stub, and `ImportPreparedActions` has no action to place a baked body. Materialization therefore needs new substrate (a baked-body feature kind + working bake + a place-baked-body prepared action), tracked as a fast-follow. v1 plans and *reports* the baked tier honestly and emits an `onshape-bake-unavailable` diagnostic instead of fabricating geometry.

4. **Parametric solid features need cross-action reference correlation** — region ids are `f(sketchId, solved ring geometry)` minted by the kernel at commit, and sketch ids are allocated by document ordinal at apply time; the provider cannot predict either, so an extrude/revolve cannot bind a just-committed sketch's region within the prepare/orderedActions model. Probe-free parametric solids are therefore blocked by a missing generic post-commit correlation mechanism (the same family as ordered actions and the probe), not by the probe itself. v1 assigns the precise `needs-region-resolution` reason code (distinct from `needs-history-probe`) so the follow-up can target the correct mechanism. Region-resolution correlation is tracked as a fast-follow alongside the probe.
2. **Fixtures assembled offline** — real capture bundles are git-ignored (proprietary), but the capture CLI's checked-in fixture transcript contains all mandatory sections, so valid bundles are assembled deterministically without network (task 2.0).
