## 1. Constraint Contract

- [x] 1.1 Add typed constraint operand records for local sketch and projected reference geometry targets.
- [x] 1.2 Add durable constraint variants for coincident-to-projected-point, point-on-projected-curve, parallel/perpendicular-to-projected-line, and supported tangent relationships.
- [x] 1.3 Update runtime schemas and normalization for the new constraint target variants.
- [x] 1.4 Add contract tests for valid, invalid, and missing projected target payloads.

## 2. Solver Support

- [x] 2.1 Evaluate point coincident with projected point constraints.
- [x] 2.2 Evaluate point-on-projected-line and point-on-projected-circle or arc constraints.
- [x] 2.3 Evaluate local line parallel/perpendicular to projected line constraints.
- [x] 2.4 Evaluate supported tangent relationships against projected circles or arcs.
- [x] 2.5 Report invalidated projected targets as diagnostics without deleting authored constraints.

## 3. Editor and Modeling Flow

- [x] 3.1 Extend constraint target resolution to include projected reference geometry candidates.
- [x] 3.2 Let explicit constraint tools collect supported projected reference targets.
- [x] 3.3 Commit reference-targeted constraints through the modeling boundary.
- [x] 3.4 Render annotations and affected-geometry highlights for constraints involving projected references.

## 4. Verification

- [x] 4.1 Add `bun:test` coverage for explicit reference-targeted constraint authoring and solving.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
