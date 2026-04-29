## Why

Active sketches already support constraints against local geometry and projected external references, but they do not expose the sketch origin point or the sketch-local X/Y axes as selectable constraint targets. That blocks a basic CAD workflow: anchoring geometry to the origin and constraining geometry directly against the sketch axes without creating stand-in construction entities first.

Assumption: the origin point and sketch-local X/Y axes should behave as sketch-session-owned read-only datum references, not as authored local sketch entities and not as external projected references.

## What Changes

- Expose the active sketch origin point and the sketch-local X and Y axes as visible, selectable datum references while editing a sketch.
- Allow supported constraint and dimension tools to target those datum references anywhere they already support compatible point or line operands.
- Define durable reference-target behavior for origin and axis operands so committed constraints can persist, re-solve, highlight, and validate without inventing local proxy geometry.
- Keep datum references read-only: selecting them for constraints must not make them draggable, deletable, or profile-producing sketch geometry.

## Capabilities

### New Capabilities
- `sketch-datum-reference-geometry`: expose the active sketch origin point and sketch-local X/Y axes as read-only selectable datum reference geometry during sketch editing.

### Modified Capabilities
- `sketch-constraint-authoring`: allow supported constraint and dimension workflows to consume sketch datum reference targets alongside existing local and projected targets.
- `sketch-reference-constraint-targets`: extend durable reference-target storage, validation, solving, and annotation highlighting to include sketch-local datum point and axis operands.

## Impact

- Affected specs: `sketch-datum-reference-geometry`, `sketch-constraint-authoring`, `sketch-reference-constraint-targets`
- Likely affected code: sketch-session renderables and picking, editor selection target schemas, constraint target resolution, durable sketch constraint operands, solver validation/resolve paths, and constraint/dimension regression coverage
- User-facing behavior: users can constrain to the origin point or sketch-local axes without drawing helper geometry first
