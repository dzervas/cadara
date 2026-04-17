## Context

The sketch session can reopen existing sketches and render points/entities, and the solver already owns sketch constraint math. What is missing is an editing lifecycle that turns a viewport drag into either a direct authored definition update or a solver-backed solved update when constraints leave valid degrees of freedom.

## Goals / Non-Goals

**Goals:**
- Select and drag existing sketch points/entities.
- Allow unconstrained geometry to move directly.
- Use real-time solving when constraints define shape but leave position or other degrees of freedom open.
- Provide clear feedback when constraints prevent the requested edit.
- Measure solver cost at 10, 50, and 150 constraints.

**Non-Goals:**
- Add full constraint editing UI.
- Add automatic constraint inference.
- Guarantee all possible constrained drag systems solve in real time.
- Build a full performance dashboard.

## Decisions

### Treat drag as a temporary solver input, not an immediate durable mutation

During pointer movement, the editor should track the dragged handle and candidate position. For unconstrained geometry, the candidate can directly update the draft. For constrained geometry, the editor should ask the solver for a solution with the dragged handle treated as a temporary target or driving condition. Only accepted results update the draft/commit request.

Alternative considered: mutate points immediately and let commit solve later. Rejected because the viewport would show invalid intermediate states and could break constrained sketches during editing.

### Preserve shape-level motion when constraints leave translation free

A properly constrained square with free X/Y position still has translational degrees of freedom. Dragging one vertex should move the square as a solved group rather than being blocked. This behavior is the key distinction between "constrained" and "immovable."

Alternative considered: block all constrained geometry drags for a first version. Rejected because it would make common sketch manipulation feel broken and would underuse the existing solver.

### Benchmark the solver with representative constraint counts

The benchmark should be simple and repeatable: solve fixed sketch fixtures with 10, 50, and 150 constraints and report elapsed time. It should be suitable for local development and regression visibility, not a strict CI performance gate unless the project later defines thresholds.

Alternative considered: add a full benchmark harness with historical tracking. Rejected as too large for this proposal.

## Risks / Trade-offs

- [Interactive solving may be too slow for larger sketches] -> add the requested benchmark and keep the first UI responsive by debouncing or falling back to feedback if needed.
- [Dragging an entity has ambiguous intent] -> start with point/vertex handles and only add whole-entity dragging when the movement rule is explicit.
- [Solver output could move geometry unexpectedly] -> show previews during drag and commit only accepted solver results.
- [Blocked edits may feel like missed clicks] -> provide explicit constrained/over-defined feedback when a drag cannot be applied.

## Migration Plan

1. Add sketch geometry selection and drag state to the editor/sketch session.
2. Implement direct point movement for unconstrained cases.
3. Add solver-backed drag solving for constrained-but-movable sketches.
4. Add blocked/no-op feedback for unsatisfied or immovable drags.
5. Add solver benchmark fixtures for 10, 50, and 150 constraints.

## Open Questions

- Whether the first implementation should support dragging line entities as a translation or only point handles.
- Whether benchmark output should be printed in tests, a dedicated script, or both.
