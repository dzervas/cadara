## Why

The archived dimension annotation stabilization left two user-visible gaps: non-parallel line dimensions do not reliably proceed as angle dimensions through placement and value entry, and deprecated directional labels still surface in dimension UI metadata. This blocks the core CAD workflow where selecting two non-parallel lines should immediately produce an editable angular dimension.

## What Changes

- Treat two non-parallel line targets in the Dimension tool as angle dimensions consistently across preview, placement, value entry, commit, and committed edit.
- Treat one selected local line segment in the Dimension tool as a line-length dimension that constrains that edge's solved endpoint distance.
- Make dimension value-entry placement robust so clicking anywhere in the viewport after required dimension targets are selected opens the floating value-entry prompt.
- Present angle value entry in degrees while preserving durable `lineAngle.valueRadians` storage.
- Remove deprecated user-facing labels such as `aligned`, `horizontal`, and `vertical` from committed dimension annotation detail text and visible value-entry copy.
- Add a committed angle-dimension annotation glyph kind so angle dimensions do not reuse generic distance glyph metadata.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sketch-constraint-authoring`: Dimension authoring and committed annotation metadata are clarified for non-parallel line angle dimensions and current dimension labels.
- `viewport-authoring-feedback`: Dimension placement clicks while awaiting value entry are clarified to pin placement and open the floating input.

## Impact

- Affected code is expected in sketch dimension target classification, dimension schemas/normalization, solver dimension evaluation, constraint-tool presentation, committed annotation descriptors, state-machine click routing, and focused Bun tests.
- No document schema migration or new dependency is expected; durable dimension kinds and radian storage remain compatible.
