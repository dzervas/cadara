## 1. Constraint Contract — pointOnImage Kind

- [x] 1.1 Add `PointOnImageConstraintDefinition` to the `ConstraintDefinition` discriminated union in `src/contracts/sketch/schema.ts` — fields: `kind: 'pointOnImage'`, `constraintId: ConstraintId`, `label: string`, `pointId: SketchPointId`, `imageEntityId: SketchEntityId`, `u: number`, `v: number`.
- [x] 1.2 Add the `pointOnImage` Zod schema variant to `src/contracts/sketch/runtime-schema.ts` — validate pointId, imageEntityId as non-empty sketch IDs, u and v in range [0, 1].
- [x] 1.3 Add unit tests for the new schema variant — valid constraint, out-of-range u/v, missing entity ID.

## 2. Solver — pointOnImage Evaluation

- [x] 2.1 Add `pointOnImage` evaluation in the solver constraint loop in `src/contracts/sketch/solver-core.ts` — resolve the image entity's 4 corner point IDs from the sketch definition, compute expected position via bilinear interpolation: `P = TL*(1-u)*(1-v) + TR*u*(1-v) + BR*u*v + BL*(1-u)*v`, compute residual as `0.5 * ||P_actual - P_expected||²`.
- [x] 2.2 Compute gradients for `pointOnImage` — partial derivatives with respect to the pinned point's (x, y) and each corner point's (x, y). The pinned point gradient is `[dx, dy]` (direct). Each corner gradient is weighted by its bilinear coefficient: TL gets `(1-u)*(1-v)`, TR gets `u*(1-v)`, BR gets `u*v`, BL gets `(1-u)*v`.
- [x] 2.3 Add `pointOnImage` to `getConstraintPoints()` (or equivalent) so the solver knows which points are coupled by this constraint.
- [x] 2.4 Add solver unit tests — pin point at (0.5, 0.5) on a unit square solves to center, pin at (0, 0) solves to TL corner, dimension between two pins adjusts corner positions.

## 3. Revised Image Import — Initial Constraint Setup

- [x] 3.1 Add 4 construction line segment entities to `createImageReferenceSketchDefinition()` in the image import provider — TL→TR, TR→BR, BR→BL, BL→TL edges, all `isConstruction: true`.
- [x] 3.2 Add structural constraints to the currently unconstrained quad: 1 fixPoint on TL, 1 horizontal on TL→TR edge, parallel between opposite edges, perpendicular between adjacent edges, equalLength between opposite edge pairs.
- [x] 3.3 Update image import provider unit tests — verify constraint count matches the new setup, verify exactly 1 fixPoint exists, verify edge entities are created.

## 4. Sketch Editor — Image Pin Placement

- [x] 4.1 Add image quad hit-testing to the sketch editor interaction layer — when the user clicks during sketch editing, test if the click position falls within the image quad (point-in-quad test using the 4 corner positions).
- [x] 4.2 Implement (u, v) computation from click position — for a rectangular quad, normalize the click position against the quad bounds. Store the computed (u, v) for the constraint.
- [x] 4.3 On image click: create a new `SketchPointDefinition` at the click position (isConstruction: true), create a `pointOnImage` constraint linking the point to the image entity at the computed (u, v), add both to the sketch definition as an authoring operation.
- [x] 4.4 Add visual indicator for image-pinned points — render pinned points with a distinct marker (pin icon, filled circle, or color) so the user can distinguish them from regular sketch points.

## 5. Validation and Integration

- [x] 5.1 Add `pointOnImage` to the solver's entity validation — check that imageEntityId resolves to an imageReference entity, check that u and v are in [0, 1], check that pointId resolves in the sketch.
- [x] 5.2 Ensure the `pointOnImage` constraint is included in sketch definition invariant checks — the referenced image entity must exist, the referenced point must exist.

## 6. Verification

- [x] 6.1 Run `bun run build` — confirm zero compile errors.
- [x] 6.2 Run `bun run lint` — confirm zero lint errors.
- [x] 6.3 Run `bun run test` — confirm all tests pass.
- [x] 6.4 Manual verification: import an image → edit the sketch → click on two ruler marks on the image (pin points appear) → draw a line between them → add a dimension constraint → image scales to match the dimension.
