## Why

Several missing upstream-equivalent sketch tools are not primitive constructors; they mutate or derive geometry from existing active sketch selections. Grouping fillet, chamfer, extend, split, and slot keeps the work centered on safe sketch-local edit operations and shared intersection/offset behavior.

## What Changes

- Add sketch-mode edit tools for fillet, chamfer, extend, split, and slot.
- Keep these separate from existing part-mode feature tools with overlapping names.
- Add selection requirements, preview, validation, accepted mutations, and history behavior for each operator.
- Implement slot as a tool that creates durable slot geometry around a selected line, spline, arc, or closed profile.

## Capabilities

### New Capabilities
- `sketch-edit-operator-tools`: Sketch-mode edit operators that mutate or derive active sketch geometry safely.

### Modified Capabilities

## Impact

- Affects `src/domain/sketch-edit-tools/`, `src/domain/sketch-editing/operations.ts`, sketch session edit state, selection filters, viewport feedback, and sketch geometry editing tests.
- Builds on existing trim/offset patterns but does not replace part-mode fillet/chamfer/split tools.
- May benefit from primitive constructor work for reusable geometry and constraint helpers, but can be implemented after current basic tools exist.
