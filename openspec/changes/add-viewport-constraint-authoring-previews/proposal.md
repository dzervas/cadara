## Why

Constraint tools need to show what relationship will be created before the user commits it. Without viewport-native preview lines, arcs, and reference disambiguation, dimension and angle tools are ambiguous and hard to trust.

## What Changes

- Render transient constraint preview graphics inside the viewport during constraint authoring.
- Show dimension preview lines for distance, horizontal distance, vertical distance, radius/diameter, and similar dimensional references.
- Show angle preview arcs between affected lines or references.
- Select among diagonal, horizontal, and vertical distance references based on mouse position near the implied reference line.
- Render value entry near the mouse or preview reference instead of in a detached feature-editor-style panel.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sketch-constraint-authoring`: Constraint workflows must provide viewport-native previews and reference disambiguation.
- `sketch-tool-editor-schema`: The schema must express preview dimension lines, angle arcs, and anchored value inputs.
- `viewport-authoring-feedback`: The viewport must render transient sketch constraint preview graphics only during authoring.

## Impact

- Affected areas include sketch constraint definitions, sketch session preview descriptors, viewport overlay/line rendering, floating input placement, and tests for dimension/angle preview selection.
- No durable document schema change is expected unless existing constraint records lack the needed reference kind.
- This change does not render committed constraint icons; that is a separate proposal.
