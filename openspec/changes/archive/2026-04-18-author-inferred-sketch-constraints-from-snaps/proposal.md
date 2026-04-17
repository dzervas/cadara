## Why

After snap inference can reliably identify user intent, accepting a snap should preserve that intent parametrically. Placement alone is not enough: snapping to a midpoint, line, or tangent should create durable constraints that survive later edits.

## What Changes

- Convert accepted snap candidates into durable inferred sketch constraints where supported.
- Add or extend constraint definitions for midpoint, point-on-curve, concentric, and tangent relationships as needed.
- Keep inferred constraints grouped with the authoring action that accepted the snap for undo/redo.
- Surface inferred-constraint preview feedback before commit.

## Capabilities

### New Capabilities
- `sketch-inferred-constraint-authoring`: Defines durable constraint creation from accepted snap intent.

### Modified Capabilities
- `sketch-constraint-authoring`: Constraint authoring includes automatic constraints derived from accepted snap candidates.
- `sketch-constraint-solver`: Solver evaluates midpoint, point-on-curve, concentric, tangent, and other inferred constraint kinds needed by snap acceptance.
- `sketch-history-navigation`: Sketch-local history treats inferred constraints as part of the accepted authoring action.

## Impact

- Affected areas: snap-to-constraint mapping, sketch tool commit contributions, constraint schemas, solver loss terms, history cursor items, viewport previews, and tests.
- Depends on `add-sketch-snap-candidate-engine`.
- Depends on `support-reference-geometry-constraint-targets` for inferred constraints involving projected reference geometry.
