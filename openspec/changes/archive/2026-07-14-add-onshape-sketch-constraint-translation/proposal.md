# Add Onshape Sketch Constraint Translation

## Why

Imported sketches are currently geometrically correct but relationship-free: the provider seeds Onshape's solved positions and drops every constraint, dimension, and derivation (deferred by dated amendment in `add-onshape-import-provider`). The result is a sketch that looks right and edits wrong — drag any point and the design intent is gone. For "interop is identity," constraint survival is the difference between importing a *model* and importing a *drawing*.

The deferral rationale was partly overstated and is now recorded as such: **local** constraint operands are plain strings (`"entityId.start"`, spike-verified), needing no probe and no correlation. The spike inventory maps every observed constraint kind to an existing `ConstraintDefinition`: COINCIDENT (155), MIDPOINT (27), HORIZONTAL (24), DISTANCE (23), LENGTH (17), PARALLEL (17), PERPENDICULAR (11), VERTICAL (9), DIAMETER (8), ANGLE (2), EQUAL (1) — plus derivations MIRROR (6), LINEAR_PATTERN (5), OFFSET (16, the `offset` derivation now exists), and PROJECTED (55, external references, stays gated). Dimensions carry expressions, and the expression translator already exists.

## What Changes

- Add **local constraint translation** to the sketch translator: table-driven mapping of Onshape constraint records to `ConstraintDefinition` kinds with operand parsing (`entityId[.start|.end|…]` → point/entity operands), covering the spike-observed kinds.
- Add **dimension translation**: DISTANCE/LENGTH/DIAMETER/ANGLE/RADIUS records become cadara dimensions with expression-backed values through the existing expression translator (variables re-drive imported dimensions).
- Add **derivation translation**: MIRROR → `mirror`, LINEAR_PATTERN → `linearPattern`, OFFSET → `offset` (from `add-sketch-offset-derivation`), mapping master/derived entity sets and per-relationship parameters.
- Add **per-constraint degradation**: an untranslatable or conflicting record drops *that record* with a structured diagnostic (kind, operands, reason) — never the sketch, never silent. PROJECTED records keep their existing external-reference gating.
- Add **solve-consistency verification**: after translation, the sketch must still solve to Onshape's seeded positions within tolerance (the solver seam already runs in `apply-pipeline.spec.ts`); a translated constraint set that moves geometry beyond tolerance is reported per-sketch and the offending constraints are identified by bisection diagnostics rather than shipped wrong.

Out of scope: PROJECTED/external constraint resolution (probe + external-reference work), constraint kinds absent from cadara's contract, inferred-constraint reconstruction for records Onshape didn't store.

## Capabilities

### Modified Capabilities

- `onshape-import-provider`: replaces the "constraints deferred" amendment with implemented local constraint/dimension/derivation translation and its degradation and verification semantics.

## Impact

- Affected code: `src/domain/import/onshape/sketch-translator.ts` (+ a constraint table module), expression-translator reuse for dimension values, planner diagnostics surface, `apply-pipeline.spec.ts` solve-consistency cases; fixture expectations across provider specs.
- Dependency impact: `add-sketch-offset-derivation` (landed) for OFFSET; independent of probe/capture-v2/baked substrate.
- Testing impact: logic lane — per-kind translation table cases from fixture bundles, operand-parsing edge cases, degradation paths, dimension-expression re-driving, solve-consistency against the real solver. Manual smoke: edit an imported sketch in-app and confirm constraints hold.

## Assumptions and Open Questions

- **Assumption:** Onshape's solved state is consistent with its own constraint set, so a faithful translation solves to the same positions; deviations indicate translation bugs and must fail loudly (never-guess applied to constraint semantics).
- **Assumption:** entities dropped during translation (unsupported kinds) have their constraints dropped with linked diagnostics — already specified in the provider spec; this change implements the constraint half.
- **Open question:** Onshape records constraints against projected/external operands mixed with local ones (e.g. coincident-to-projected). Proposed: translate when the projected geometry was imported as fixed construction geometry, binding to it; otherwise drop that record with the external-reference diagnostic.
- **Open question:** dimension display placement (leader positions) — Onshape stores label placement; v1 may use cadara defaults and note the cosmetic loss.
