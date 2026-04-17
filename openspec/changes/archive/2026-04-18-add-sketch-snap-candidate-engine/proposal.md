## Why

Sketch drawing needs immediate geometric intent feedback before it can safely author automatic constraints. A pure snap candidate engine provides deterministic, testable snap inference for local and projected geometry without changing durable sketch data yet.

## What Changes

- Add a sketch-space snap candidate resolver used by active sketch tools.
- Support endpoints, centers, midpoints, nearest-on-curve, intersections, horizontal/vertical alignment, perpendicular feet, and tangent candidates where determinable.
- Include projected reference geometry as snap input when available.
- Render transient snap previews and use snapped positions for live tool previews.
- Do not commit inferred constraints in this change.

## Capabilities

### New Capabilities
- `sketch-snap-inference`: Defines deterministic snap candidate discovery, ranking, and preview behavior.

### Modified Capabilities
- `viewport-authoring-feedback`: Viewport feedback includes transient snap indicators and labels.
- `sketch-tool-editor-schema`: Sketch tool previews can consume snap-adjusted pointer coordinates and snap metadata.

## Impact

- Affected areas: new pure snap inference module, sketch session pointer handling, sketch tool preview context, viewport feedback overlays, projected reference geometry inputs, and tests.
- Depends on `add-sketch-reference-geometry-authoring` for reference geometry snapping, but can support local geometry first.
- Does not create durable constraints.
