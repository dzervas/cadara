## 1. Contracts And Authoring

- [x] 1.1 Add loft path participant and path option shape with `sectionCount` default `5`.
- [x] 1.2 Add guide continuity option shape tied to guide curve participants.
- [x] 1.3 Add profile start/end condition option shape.
- [x] 1.4 Add match connection contract shape for durable vertex/edge alignment controls.
- [x] 1.5 Update loft draft creation, hydration, patching, validation, and buildDefinition.
- [x] 1.6 Update loft form schema for path, section count, guides, profile conditions, and connections.

## 2. Geometry

- [x] 2.1 Implement OCC loft path-only behavior with section-count-driven intermediate sections.
- [x] 2.2 Implement OCC guide-only loft behavior for guide curves without guide continuity.
- [x] 2.3 Implement at least one OCC guide-continuity mode for guide-curve lofts.
- [x] 2.4 Implement supported normal/tangent profile condition behavior.
- [x] 2.5 Implement at least one match connection alignment behavior for two ordered profiles.
- [x] 2.6 Add structured diagnostics for unsupported path/guide/continuity combinations.

## 3. Tests

- [x] 3.1 Add authoring and persistence tests for path plus default and explicit section count.
- [x] 3.2 Add contract tests proving path and guides remain distinct and can coexist in the durable definition.
- [x] 3.3 Add validation tests for invalid section count, invalid guide curves, and incomplete connections.
- [x] 3.4 Add OCC adapter tests for the minimum supported matrix: path-only, guide-only without guide continuity, one guide-continuity mode, supported normal/tangent profile condition, and one-connection two-profile cases.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
