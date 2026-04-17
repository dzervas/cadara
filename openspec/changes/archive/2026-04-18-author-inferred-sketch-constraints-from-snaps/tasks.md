## 1. Constraint Mapping

- [x] 1.1 Define snap-candidate-to-constraint mapping for endpoint coincidence, midpoint, point-on-curve, horizontal, vertical, parallel, perpendicular, tangent, and concentric candidates.
- [x] 1.2 Add durable constraint variants for missing inferred relationships without removing existing constraint variants.
- [x] 1.3 Add runtime schema and normalization support for the new inferred constraint variants.
- [x] 1.4 Add tests that accepted snaps append the expected durable constraint records.

## 2. Solver Support

- [x] 2.1 Implement midpoint constraint solving.
- [x] 2.2 Implement point-on-line and point-on-circle or arc solving for local and projected targets.
- [x] 2.3 Implement tangent and concentric constraint solving for supported entity combinations.
- [x] 2.4 Report over-constrained or invalid inferred constraints through existing solve diagnostics.

## 3. Editor and History Integration

- [x] 3.1 Extend sketch tool commit context to carry accepted snap metadata.
- [x] 3.2 Append inferred constraints through the same sketch commit path as the accepted authoring action.
- [x] 3.3 Keep undo/redo behavior coherent for geometry plus inferred constraints.
- [x] 3.4 Render preview feedback for constraints that will be inferred on accept.

## 4. Verification

- [x] 4.1 Add focused `bun:test` coverage for inferred constraints from local and projected snap candidates.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
