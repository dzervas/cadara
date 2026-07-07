# Add Import Action Correlation

## Why

The Onshape import provider ships probe-less v1 with a measured baseline (change notes, 2026-07-06): 18 of 51 real-document features degrade to `baked` solely with `needs-region-resolution` — every extrude in both reference documents — and 27 more carry `downstream-of-baked` cascades those bakes cause. The blocker is not translation and not the kernel probe: it is that prepared import actions cannot reference outputs of earlier actions. An extrude profile is `{ kind: "region", sketchId, regionId }`, but the sketch id is allocated when `commitSketch` applies and the region id is derived from the committed solved geometry; a cut extrude additionally needs the `bodyId` a previous extrude's apply created. The prepare/apply contract requires fully-formed requests up front, so history-faithful chains (sketch → extrude → cut) are unrepresentable.

The fix is generic — any future history-preserving importer (FreeCAD, Fusion archives) hits the same wall — and the pieces already exist: the orchestrator applies actions sequentially on one revision chain with atomic rollback, and cadara's region extraction is a pure contract function, so region membership can be *verified* during non-mutating review and only the concrete ids need substitution at apply time.

Measured payoff: unblocking `needs-region-resolution` alone takes HackerBoard/Mounts from 5/10 toward ~8/10 parametric and collapses most of Taskariki's cascade — the single highest fidelity-per-effort item on the fast-follow list.

## What Changes

- Add **deferred output references** to the import prepared-actions contract: typed placeholders that stand in for apply-time values — the `sketchId` allocated by an earlier `commitSketch` action, a `regionId` of that committed sketch selected geometrically (interior-point selector), and the `bodyId` created by an earlier `createFeature` action. References name the producing action by ordered-sequence position; validation rejects forward-referencing an action that has not applied yet, references to actions of the wrong kind, and dangling indices — before anything applies.
- Add **apply-time resolution** in the orchestrator: after each action applies, its outputs are recorded; before each action applies, its deferred references are substituted with concrete ids. Region selectors resolve through the same region-extraction seam interactive extrude authoring uses, against the committed sketch's actual solved state. An unresolvable reference fails the import atomically (existing rollback) with a diagnostic naming the action, the reference, and the selector — never a guess.
- Update the **Onshape provider**: extrudes (and future revolves) consuming regions of parametric-tier sketches plan `parametric` — profile emitted as a deferred region reference whose interior-point selector is verified against cadara's own region extraction during review; `NEW` extrudes map to `standalone` boolean scope, and `ADD`/`REMOVE`/`INTERSECT` with Onshape default scope map to a deferred body reference of the single upstream body-producing action. Explicit Onshape boolean-scope references and multi-body-ambiguous scopes remain probe-gated (`needs-history-probe`); `needs-region-resolution` remains only for regions whose selector cannot be verified at review.
- Re-record the per-tier baseline for both reference bundles and compare against the probe-less v1 numbers in the change notes.

Out of scope: the kernel history probe (`add-kernel-topology-signatures`), baked-tier materialization, constraint translation, and any new feature kinds. Deferred references cover exactly three output kinds (sketch id, region of committed sketch, created body); face references stay probe-gated.

## Capabilities

### Modified Capabilities

- `import-provider-contract`: Prepared actions MAY carry deferred output references across the ordered sequence; the orchestrator SHALL resolve them at apply time with strict pre-validation, atomic failure semantics, and no behavior change for providers that do not use them.
- `onshape-import-provider`: Region-consuming solid features on parametric sketches plan `parametric` via deferred references with review-time selector verification; reason-code semantics for `needs-region-resolution` narrow accordingly, and default-scope boolean mapping is specified.

## Impact

- Affected code: `src/contracts/import/actions.ts` (+ validation), `src/domain/import/orchestrator.ts` (output recording, substitution, region resolution seam), `src/domain/import/onshape/fidelity-planner.ts` (extrude planning + review-time region verification), `src/domain/import/onshape/provider.ts` (deferred-ref emission, feature translation for extrude parameters), `src/domain/import/onshape/apply-pipeline.spec.ts` (extended seam coverage with the real solver).
- Affected APIs/contracts: additive extension of `ImportPreparedActions`; no modeling-kernel contract changes — resolution uses existing responses and the pure region-extraction contract.
- Dependency impact: depends on `add-onshape-import-provider` (ordered actions, rollback, planner, baseline). Independent of the kernel probe change; both can proceed in parallel.
- Performance impact: one region-extraction evaluation per committed sketch with region consumers, at apply time; review-time verification reuses the already-translated solved definitions. Negligible against kernel rebuild cost.
- Testing impact: logic lane per `docs/testing.md` — contract validation cases, orchestrator resolution/failure paths against the real-solver apply pipeline, planner tier changes against fixture bundles; baseline re-recorded manually in change notes.

## Assumptions and Open Questions

- **Assumption:** an interior probe point is a robust region selector across the Onshape→cadara solve boundary (solved positions are seeded, so regions match up to solver tolerance). The selector tolerance policy is the planner's, mirroring the never-guess rule: ambiguous containment (point inside multiple regions due to nesting) resolves to the innermost containing region, matching interactive pick semantics — verify against the in-app picker's convention during implementation.
- **Assumption:** capture bundles carry enough geometry to compute interior points for Onshape's region queries (region faces resolve as planar faces with tessellation samples). If a bundle predates tessellation samples for region faces, the provider falls back to computing interior points from the translated 2D geometry itself; if neither works, the feature stays `baked` with the existing reason code.
- **Open question:** single-upstream-body inference for default-scope booleans — v1 proposes: resolvable only when exactly one prior body-producing action exists in the plan; otherwise probe-gated. Multi-body documents will keep some extrudes baked until the probe lands. Stated so nobody mistakes it for full boolean-scope resolution.
