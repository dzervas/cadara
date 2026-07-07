## 1. Contract

- [x] 1.1 Add the `ImportDeferredValue` union (sketchIdOf / regionOf+interiorPoint selector / bodyOf) and its blessed-position map to `src/contracts/import/actions.ts`, with Typia validation.
- [x] 1.2 Extend ordered-sequence invariant validation: backward-only references, kind-matched producers, in-bounds indices, deferred values only at blessed positions.
- [x] 1.3 Add contract `.spec.ts` accept/reject coverage (logic lane, per `docs/testing.md`).

## 2. Orchestrator Resolution

- [x] 2.1 Record per-action outputs during the apply walk (sketch ids from commit responses; created body ids from feature responses).
- [x] 2.2 Implement materialization: substitute deferred values into a concrete request immediately before each apply.
- [x] 2.3 Implement region resolution against the referenced sketch's committed solved state via the region-extraction seam, with innermost-containment selection verified against the interactive picker's convention.
- [x] 2.4 Implement atomic failure on unresolvable references with diagnostics naming consumer, reference, and selector.
- [x] 2.5 Extend `apply-pipeline.spec.ts` (real solver): sketch→extrude chain, sketch→extrude→cut chain with `bodyOf` scope, unresolvable-selector rollback, nested-ring innermost selection, no-deferred-refs regression.

## 3. Onshape Provider

- [ ] 3.1 Implement extrude parameter translation (extents from Onshape flag-gated parameters, boolean operation mapping, expression-backed depths) emitting deferred region references.
- [ ] 3.2 Implement interior-point derivation: capture tessellation samples first, translated 2D ring fallback.
- [ ] 3.3 Implement review-time selector verification through the pure region-extraction contract over translated solved sketches; planner tiers region consumers accordingly and narrows `needs-region-resolution` semantics.
- [ ] 3.4 Implement narrow boolean-scope mapping (NEW→standalone; default-scope single-upstream-body→deferred bodyOf; otherwise probe-gated).
- [ ] 3.5 Update fixture-driven planner/provider `.spec.ts` coverage: fixture bundle's extrude now plans parametric; scope-ambiguity and selector-failure paths.

## 4. Verification

- [ ] 4.1 Manual smoke: re-import both real capture bundles; confirm extrudes rebuild with correct geometry against the in-app viewport.
- [ ] 4.2 Re-record the per-tier baseline in `add-onshape-import-provider/notes/tier-baseline.md` (new section) and compare against the probe-less v1 table.
- [ ] 4.3 Run `bun run test:all`.
