## Why

The `Measure` toolbar tool already exists, but it does not perform any real inspection work yet. Users need a transient way to inspect lengths, areas, distances, curve properties, and solid volume directly in the viewport without creating durable dimensions or leaving the main modeling flow.

## What Changes

- Turn `Measure` into a real part-mode inspect workflow backed by the editor runtime instead of the current logging-only behavior.
- Allow one-target and two-target measurement selection for measurable geometry, including bodies, faces, edges, vertices, sketch/profile geometry, and selectable projected curve references.
- Show a compact bottom-left measurement panel positioned to the right of the state debugger and populate it only with applicable values for the current measurement selection.
- Support geometry-specific measurements for lines, arcs, circles, and splines in addition to body, face, and pairwise distance measurements.
- Render retained viewport measurement feedback with a bright yellow thicker line and soft halo treatment, and clear stale feedback whenever the measurement selection is replaced, the tool is disabled, or selection is cleared.
- Preserve the current separation between runtime command state, geometry/measurement resolution, presentational overlays, and viewport rendering.

## Capabilities

### New Capabilities

- `measure-tool-inspection`: Transient measurement selection, measurement readouts, geometry-specific measure resolution, and retained viewport feedback for the Measure tool.

### Modified Capabilities

None.

## Impact

- Affected code is expected in tool activation/runtime plumbing, command selection filters, measurement resolution/domain helpers, viewport measurement renderables, and bottom-left overlay presentation.
- Tests should cover tool lifecycle, supported target combinations, conditional readout visibility, curve-specific measurements for arcs/circles/splines, retained highlight lifecycle, and selection-clear/tool-cancel cleanup.
- No new product-facing persistence or document-schema migration is expected.
