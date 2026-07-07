# Design: Import Action Correlation

## Context

- Measured blocker from the probe-less baseline: 18 features baked with `needs-region-resolution` (every extrude in both reference documents), plus the `downstream-of-baked` cascade they cause.
- Contract facts driving the shape: `ExtrudeProfileRef` = `{ kind: "region", sketchId, regionId }`; `RegionId` is derived from the committed sketch's solved rings (`createRegionId(sketchId, ring)` in the pure `region-extraction` contract); `CommitSketchResponse` returns only `sketchId`; `CreateFeatureResponse` reports created bodies through changed targets. Sketch ids and body ids are allocated at apply time.
- The orchestrator already applies one ordered sequence on a single revision chain with counting rollback — the exact substrate deferred resolution needs.

## Decision 1: Deferred references are data, not callbacks

`ImportPreparedActions` values that must wait for apply time are expressed as a closed union of placeholder objects:

```
ImportDeferredValue =
  | { kind: "sketchIdOf",  actionIndex }                       // commitSketch output
  | { kind: "regionOf",    actionIndex, selector }             // region of that committed sketch
  | { kind: "bodyOf",      actionIndex }                       // body created by that createFeature
selector = { kind: "interiorPoint", point: SketchPoint2D }     // sketch-plane 2D coordinates
```

Placeholders may appear only at contract-blessed positions (extrude profile refs, boolean scope body refs — a typed map, not free-form request surgery). `actionIndex` addresses the ordered sequence. This stays serializable, Typia-validatable, and inspectable in diagnostics — consistent with how the rest of the import contract treats data over behavior.

## Decision 2: Strict pre-validation, then substitution during the apply walk

Before anything applies, validation extends the existing ordered-sequence invariants: every deferred reference must point backward in the sequence, at an action of the producing kind, within bounds. During the walk the orchestrator records each action's outputs (sketch id; created body ids) and materializes concrete requests just before apply.

Region resolution runs when a `regionOf` reference is consumed: extract regions from the referenced sketch's committed solved state through the same region-extraction seam interactive extrude authoring uses, then select by interior-point containment (innermost region on nested containment, matching interactive pick semantics). Resolution failure — no containing region, or the referenced action failed to produce output — throws with a diagnostic naming the consuming action, the reference, and the selector; the existing counting rollback makes the failure atomic. No guessing, no nearest-match fallback.

## Decision 3: Review-time verification keeps `review()` honest

The Onshape planner only marks a region-consuming feature `parametric` after verifying, during review, that the interior-point selector selects exactly one region in cadara's own region extraction run over the *translated* solved sketch definition (pure function, no kernel, no mutation). Apply-time resolution then re-runs against the *committed* solved state — the seeded solve makes divergence a tolerance-level event, and if it happens anyway the atomic failure surfaces it rather than importing wrong geometry. Interior points come from the capture's region-face tessellation samples, falling back to points computed from the translated 2D rings.

## Decision 4: Boolean scope mapping stays narrow

- Onshape `NEW` → `{ kind: "standalone" }`.
- `ADD`/`REMOVE`/`INTERSECT` with Onshape default scope → deferred `bodyOf` the plan's single prior body-producing action; if zero or multiple candidates exist, the feature stays probe-gated. This is lineage inference only in the unambiguous case — full boolean-scope resolution is the probe's job.
- Explicit Onshape `booleanScope` queries remain `needs-history-probe`.

## Decision 5: Reason-code narrowing is part of the contract

After this change, `needs-region-resolution` means "the region selector could not be verified at review" — not "regions are categorically unresolvable". The fidelity report's honesty depends on reason codes tracking reality; the spec delta updates the scenario language accordingly, and the re-recorded baseline in the change notes quantifies the shift.

## Decision 6: Testing (per docs/testing.md)

Lane: **logic**. Seams: deferred-value contract validation (backward-only, kind-matched, in-bounds, blessed positions only); orchestrator substitution and failure paths through the real-solver apply pipeline (`apply-pipeline.spec.ts` gains sketch→extrude and sketch→extrude→cut chains, unresolvable-selector atomic rollback); planner review-time verification and boolean-scope mapping against fixture bundles; innermost-containment selection on a nested-ring fixture. Baseline re-run on both real bundles recorded manually in change notes, comparing against the probe-less v1 table. No UI or e2e lanes.

## Risks

- Solver tolerance shifts a region boundary across the probe point → mitigated by seeding solved positions (already in place), innermost-containment rule, and atomic failure on miss; if real bundles show misses, the selector gains a tolerance band before any fallback heuristics are considered.
- Mock kernel's committed solved state may differ from OCC's → the apply-pipeline seam uses the real constraint solver (already wired), which owns solved geometry; the kernel only stores it. Divergence here would indicate a kernel-adapter parity bug, which the seam test would surface.
- Scope creep toward general request templating → prevented by the blessed-position map and the closed three-variant union; anything else is a new change.
