## Why

Sketch geometry can be created but not meaningfully edited, which makes the sketch interface feel incomplete. Users need to drag under-constrained geometry directly, and constrained sketches should use the solver when a drag has a valid degree of freedom.

## What Changes

- Add direct selection and drag editing for existing sketch points and entities.
- Update authored sketch definitions from valid direct edits.
- Use the sketch constraint solver for constrained-but-movable edits, such as dragging a vertex of a fully shaped square whose X/Y position remains unconstrained.
- Block or no-op edits that conflict with constraints, with visible feedback explaining that the geometry is constrained.
- Add a simple solver benchmark that measures solve time for sketches with 10, 50, and 150 constraints.

## Capabilities

### New Capabilities

- `sketch-geometry-editing`: Defines direct selection and drag editing behavior for authored sketch geometry.

### Modified Capabilities

- `sketch-constraint-solver`: The solver must support interactive dragged-handle solves and include benchmark coverage for common constraint counts.
- `frontend-modeling-boundary`: Direct edits must keep transient drag state in the editor while committing accepted authored sketch changes through the modeling boundary.

## Impact

- Affected areas include sketch session state, viewport picking and drag handling, sketch definition mutation helpers, solver adapter APIs, solve diagnostics, and tests/benchmarks.
- This proposal may require new editor-domain tests plus solver-domain benchmark coverage.
- This change does not add new drawing tools or constraint glyph rendering.
