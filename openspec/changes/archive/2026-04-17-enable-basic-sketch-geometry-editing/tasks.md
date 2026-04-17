## 1. Direct Editing Lifecycle

- [x] 1.1 Add editor/sketch-session state for active sketch geometry selection and drag handles.
- [x] 1.2 Route viewport drag events for selected sketch points or handles without conflicting with drawing-tool creation.
- [x] 1.3 Update authored sketch definitions for valid unconstrained point movement.

## 2. Solver-Backed Constrained Movement

- [x] 2.1 Add a solver/editor API for solving a sketch with a temporary dragged handle target.
- [x] 2.2 Support translating a fully shaped square or equivalent constrained group when its X/Y position remains unconstrained.
- [x] 2.3 Block or no-op over-constrained edits with visible feedback instead of corrupting the sketch draft.

## 3. Tests And Benchmarks

- [x] 3.1 Add tests for unconstrained point dragging updating the sketch definition.
- [x] 3.2 Add tests for constrained-but-translatable square dragging moving the full solved shape.
- [x] 3.3 Add tests for immovable constrained geometry producing blocked/no-op feedback.
- [x] 3.4 Add a simple benchmark that reports solve time for sketches with 10, 50, and 150 constraints.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
