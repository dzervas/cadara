# Add Onshape Surface Extrude Import

## Why

`add-surface-body-modeling` landed the whole surface substrate — the `resultBodyType` discriminated
extrude contract, open sketch-curve profile refs, sheet-body tracking, and the real OCC wire-sweep
path — but explicitly deferred the Onshape importer. The importer therefore still bakes every
`bodyType: SURFACE` extrude with `extrude-body-type-unsupported`, even though the kernel can now
rebuild exactly those features as sheet bodies. Two local captures each contain one such feature:

- `9841e486906fa2ce62d74d8e` `Extrude 4`: `SURFACE`, `UP_TO_SURFACE` end bound, one
  `qConstructionFilter(qBodyType(qCreatedBy(<sketch>, EDGE), WIRE), NO)` profile query naming a
  two-segment open sketch chain.
- `d3cd9b09c3c36af1dd2efae9` `Extrude 4`: `SURFACE`, `BLIND` end bound with Onshape's `symmetric`
  flag, four `qCompressed(... queryType=SKETCH_ENTITY, entityType=EDGES ...)` profile queries naming
  four connected sketch line segments.

Assumptions: the kernel surface path is complete and is not re-implemented here; Onshape surface
revolves do not occur in any local capture and stay out of scope; no legacy or compatibility
handling is required.

## What Changes

- Plan Onshape `bodyType: SURFACE` extrudes as surface extrude features instead of baking them, with
  profiles read from the `surfaceEntities` parameter and no boolean-operation translation.
- Resolve Onshape open sketch-curve profile queries (compressed `SKETCH_ENTITY` edge queries and
  readable whole-sketch wire `qCreatedBy` queries) to durable sketch entity references of the
  translated solved sketch, and defer their sketch id to the sketch's commit action.
- Extend the import prepared-action contract so an extrude definition can carry the surface
  parameter variant (no `operation`, no `booleanScope`) and open sketch-curve profile refs whose
  `sketchId` defers through `sketchIdOf`.
- Translate Onshape's `symmetric` extrude flag, whose omission would make an imported surface
  extrude disagree with captured ground truth (`d3cd` `Extrude 4` spans ±25 mm for a 50 mm depth).
- Keep baking, with explicit reason codes, surface extrudes whose draft angle, boolean operation,
  or profile queries the surface contract or the kernel cannot represent.
- Reject open sketch-curve profiles in solid extrudes with an accurate kernel message instead of the
  stale "not implemented yet" wording.

## Capabilities

### Modified Capabilities

- `onshape-import-provider`: surface extrudes translate to surface feature definitions, open-curve
  profile queries resolve to durable sketch entity refs, and unsupported surface forms bake with
  explicit reasons.
- `import-provider-contract`: extrude prepared actions may carry the surface parameter variant and
  deferred open sketch-curve profile refs.

## Impact

- Affected code: `src/contracts/import/actions.ts`, `src/contracts/import/validation.ts`,
  `src/domain/import/orchestrator.ts`, `src/domain/import/onshape/profile-resolver.ts`,
  `src/domain/import/onshape/sketch-point-query-reader.ts`,
  `src/domain/import/onshape/extrude-planner.ts`,
  `src/domain/import/onshape/extrude-feature-translator.ts`,
  `src/domain/import/onshape/provider.ts`, and the Wave X surface-extrude capture fixture.
- Revolve planning is untouched: no local capture contains a `SURFACE` revolve, so its body-type
  skip stays.
- Testing impact: logic lane only — extrude planner, profile resolver, provider/apply-pipeline, and
  fidelity-planner specs.
