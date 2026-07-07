# Relax Import Bake Cascade

## Why

The Onshape planner's v1 cascade rule is positional: once any solid feature bakes, every later solid feature is `downstream-of-baked`. Measured on Taskariki: the first solid consumes a probe-gated sketch, so 24 features carry `downstream-of-baked` — including chains that are completely independent of the baked branch (parametric Sketch 8 → Extrude 13 consumes nothing from the baked lineage). The positional rule was the correct conservative v1 choice when no dependency information was modeled; with action correlation landed, the planner now knows each feature's actual inputs (owning sketch, region, deferred body lineage) and can bake only true dependents.

This is planner-only work — no kernel, no contract changes — and it compounds with every other fidelity change: independent branches stay live today, and after the probe lands, cascades shorten further instead of being all-or-nothing.

## What Changes

- Replace the positional cascade with **dependency-graph propagation**: a feature carries `downstream-of-baked` only when one of its resolved inputs (owning sketch, profile region source, deferred body lineage, explicit upstream reference) is baked-tier or belongs to a baked lineage.
- Boolean lineage stays honest: default-scope booleans resolve against the single upstream body-producing action *within their own lineage*; a baked branch does not silently disappear from candidate counting — if the baked branch could have contributed a body to the scope, the consumer remains probe-gated rather than mis-resolved.
- Re-record the per-tier baseline for both reference bundles.

Out of scope: any new resolution mechanisms; this only stops over-application of the cascade.

## Capabilities

### Modified Capabilities

- `onshape-import-provider`: `downstream-of-baked` semantics change from positional to dependency-based.

## Impact

- Affected code: `src/domain/import/onshape/fidelity-planner.ts` (+ specs); possibly `extrude-planner.ts` candidate counting.
- Testing impact: logic lane — planner specs for independent-branch liveness, true-dependent baking, and the boolean-candidate honesty case; fixture additions for a two-branch history; baseline re-run recorded in change notes.

## Assumptions and Open Questions

- **Assumption:** the planner's input model (from correlation work) captures all real dependencies for the currently-parametric feature set (sketch, region, body lineage). Features with reference kinds the planner cannot see (probe-gated ones) are already baked on their own reason codes, so under-modeling cannot un-bake a true dependent.
- **Open question:** whether a baked *body* (once the baked substrate lands) should count as a resolvable boolean participant for downstream parametric features. Deferred: candidate counting treats baked lineage as opaque until the substrate exists; revisit in that change's integration.
