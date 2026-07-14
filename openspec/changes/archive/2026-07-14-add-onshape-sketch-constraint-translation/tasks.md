## 1. Constraint Table

- [x] 1.1 Implement operand parsing (`entityId[.start|.end|.center|…]` → point/entity operands against translated id maps) with edge-case `.spec.ts` coverage (logic lane, per `docs/testing.md`).
- [x] 1.2 Implement the local constraint table (COINCIDENT, MIDPOINT, HORIZONTAL, VERTICAL, PARALLEL, PERPENDICULAR, EQUAL, TANGENT/CONCENTRIC if present in fixtures) with per-record degradation diagnostics.
- [x] 1.3 Implement dimension translation (DISTANCE, LENGTH, DIAMETER, ANGLE, RADIUS) with expression-backed values via the expression translator.
- [x] 1.4 Implement derivation translation: MIRROR → `mirror`, LINEAR_PATTERN → `linearPattern`, OFFSET → `offset` (master/derived mapping, distance/halfSpace normalization per the offset contract).
- [x] 1.5 Handle mixed local/external operands: bind to imported fixed projection geometry when present, otherwise drop with the external-reference diagnostic.

## 2. Verification Machinery

- [x] 2.1 Implement post-translation solve-consistency check against seeded positions with tolerance, and bisection isolation of offending records on failure.
- [x] 2.2 Extend `apply-pipeline.spec.ts` (real solver): constrained fixture sketch commits position-stable; a deliberately-broken table entry triggers isolation + degradation, not a wrong commit.

## 3. Integration

- [x] 3.1 Update sketch-translator module docs and remove the "constraints deferred" amendment notes; update the provider spec-delta bookkeeping.
- [x] 3.2 Update fixture-driven provider/planner specs (fixture sketches now carry constraints/dimensions/derivations).
- [x] 3.3 Update the review form's sketch diagnostics to summarize carried vs dropped relationship counts per sketch.

## 4. Verification

- [x] 4.1 Manual smoke: import both real bundles; in-app, drag constrained geometry and edit a variable-driven dimension; record carried/dropped relationship counts per sketch in change notes.
- [x] 4.2 Run `bun run test:all`.
