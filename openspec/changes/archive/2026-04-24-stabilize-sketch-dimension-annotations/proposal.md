## Why

Committed sketch dimensions currently read like generic constraint badges instead of CAD dimension annotations: the viewport chip shows a normal annotation glyph, the text repeats verbose labels such as `Rectangle 1 height 10.00`, and the draggable/editable affordance does not match what the user sees. Angular dimensions also become hard to read when the measured angle lies outside the finite line segments because the viewport does not extend dashed witness lines to the true referenced intersection.

This gap now blocks basic dimension-editing workflows and makes the current implementation feel fragile. The code already contains separate paths for durable dimension records, viewport overlays, and committed annotation chips, so the proposal should tighten those contracts instead of layering on more one-off fixes.

## What Changes

- Render committed dimensions as dimension-specific annotations instead of generic constraint-style chips.
- Replace verbose committed dimension annotation text such as `Rectangle 1 height 10.00` with compact `dimension icon + value` presentation while preserving accessible labels for assistive text and debugging.
- Keep double-click editing on committed dimension annotations and define it as a first-class dimension annotation interaction.
- Move committed dimension-drag initiation from the dimension line/angle arc overlay hit area to the visible dimension annotation icon so the user drags the annotation they see.
- Extend angular dimension rendering to show dashed witness/extension lines beyond finite line segments when the measured angle references an off-segment intersection.
- Document and isolate the fragile interaction boundaries between annotation descriptors, overlay descriptors, and viewport drag/edit routing so implementation work can close current bug classes without a full annotation rewrite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sketch-constraint-authoring`: committed dimensions gain compact dimension-specific annotation presentation plus stable edit and drag interactions rooted in the committed annotation itself.
- `viewport-authoring-feedback`: committed dimension rendering and hit-testing gain annotation-icon drag handles and angular witness-line feedback that can extend beyond the measured line segments.

## Impact

- Affected code is expected in sketch annotation descriptor generation, dimension label/detail formatting, committed annotation rendering, viewport drag routing, committed dimension overlay generation, and angular-dimension projection logic.
- Tests should cover compact dimension annotation rendering, accessible labels, double-click edit reopening, annotation-icon drag behavior, and angle witness-line rendering for off-segment intersections.
- No new runtime dependencies are expected.
