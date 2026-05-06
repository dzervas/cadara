## 1. Point Tool Audit And Hardening

- [x] 1.1 Audit existing Point tool registration, toolbar/search exposure, runtime activation, staged preview, commit contribution, and persistence path before adding new Point code.
- [x] 1.2 Fix any missing Point reachability or durable commit gaps without introducing a duplicate Point tool ID.
- [x] 1.3 Ensure standalone point entities are selectable, deletable, snap-visible, and usable as editable local point targets for existing constraint tools.

## 2. Collinear Contract And Tool Definition

- [x] 2.1 Add durable collinear constraint contract fields and runtime validation for local point, local line, projected/read-only line, and datum-line operands where needed.
- [x] 2.2 Add `constraintCollinear` to sketch constraint tool IDs, metadata, icon/glyph resolution, toolbar grouping, and command/search availability.
- [x] 2.3 Implement Collinear target resolution for editable points, editable local lines, projected lines, and supported datum lines while rejecting circles, arcs, splines, regions, dimensions, and read-only-only target sets.
- [x] 2.4 Implement Collinear preview, selection-order behavior, multi-target reference handling, invalid-target feedback, and durable commit contribution creation.

## 3. Solver And Runtime Integration

- [x] 3.1 Implement solver-owned collinear residuals for local line-to-line, point-to-line, local target-to-projected-line, and supported datum-line relationships using infinite line geometry.
- [x] 3.2 Add diagnostics for missing operands, unsupported operands, and degenerate collinear reference lines without inventing fallback geometry.
- [x] 3.3 Integrate committed Collinear annotations into sketch-session display, selection, highlighting, deletion, undo/redo, save/restore, and rebuild flows.
- [x] 3.4 Verify projected/read-only line references remain read-only and only editable local point or line geometry moves during solve.

## 4. Tests And Validation

- [x] 4.1 Add logic-lane tests for Point reachability/durable standalone point commit if the audit exposes missing coverage.
- [x] 4.2 Add logic-lane tests at the sketch constraint registry/session seam for Collinear target ordering, line-line, point-line, projected-line, multi-target, invalid-target, and read-only-only rejection behavior.
- [x] 4.3 Add logic-lane solver tests for non-overlapping line collinearity, point beyond segment bounds, projected line collinearity, and degenerate/missing reference diagnostics.
- [x] 4.4 Add focused UI-lane tests only if toolbar exposure or generic annotation rendering cannot be proven through existing domain/presentation tests.
- [x] 4.5 Run `bun run test:all` and fix any regressions before marking the change complete.
