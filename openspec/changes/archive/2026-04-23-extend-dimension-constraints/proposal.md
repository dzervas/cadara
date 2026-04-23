## Why

The Dimension sketch tool currently does not cover common CAD dimension workflows such as diameter dimensions, edge-to-edge offsets, edge-to-vertex distances, or angular dimensions between non-parallel lines. Users also need the transient dimension annotation itself to be placed interactively, so the preview communicates the intended measurement before the durable dimension is committed.

## What Changes

- Extend sketch dimension authoring to support diameter dimensions for circles and arcs.
- Extend distance dimension authoring to support edge-to-edge and edge-to-vertex target combinations in addition to existing point-based dimensions.
- Extend angular dimension authoring to support angle dimensions between two non-parallel sketch line references.
- Add transient draggable annotation geometry for pending dimensions: a draggable dimension line for linear/diameter dimensions and a draggable arc for angle dimensions.
- Persist the chosen annotation placement with the committed dimension so committed rendering can reproduce the user's chosen offset or arc radius.
- Preserve existing separation between frontend preview placement, durable sketch document records, and solver-owned constraint evaluation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sketch-constraint-authoring`: Dimension target selection, value entry, durable dimension records, and committed annotation rendering gain diameter, edge/vertex distance, and angle dimension workflows.
- `sketch-constraint-solver`: Supported driving dimensions expand from distance/radius to include diameter, edge-to-edge distance, edge-to-vertex distance, and angle dimensions.
- `viewport-authoring-feedback`: Transient sketch constraint previews become draggable placement controls for dimension lines and angle arcs.

## Impact

- Affected code is expected in sketch constraint operation definitions, sketch document/dimension contract types, editor constraint-authoring state, sketch solver dimension terms, viewport overlay/preview rendering, and annotation hit-testing/selection plumbing.
- Tests should cover supported target combinations, invalid target rejection, durable annotation placement, solver term evaluation, and viewport preview descriptor generation.
- No new runtime dependencies are expected.
