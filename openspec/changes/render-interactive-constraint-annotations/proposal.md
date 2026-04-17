## Why

Committed constraints and dimensions should be visible and manageable directly in the viewport. A side-panel list is not enough for CAD-style sketching because users need to see which geometry each constraint affects and remove constraints in context.

## What Changes

- Render committed constraint and dimension annotations as small viewport glyphs near affected geometry.
- Use distinct icons or glyph treatments for supported constraint kinds.
- Highlight affected geometry when a committed annotation is hovered or clicked without selecting the geometry itself.
- Select committed annotations as annotation targets.
- Remove the selected committed constraint or dimension when the user presses Delete or Backspace.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sketch-constraint-authoring`: Committed annotations must be visible, hoverable, selectable, and removable in the viewport.
- `viewport-authoring-feedback`: The viewport must render and hit-test committed constraint annotation glyphs.
- `frontend-modeling-boundary`: Annotation deletion must resolve to durable sketch mutations through the modeling boundary.

## Impact

- Affected areas include annotation descriptor generation, viewport overlay rendering and hit-testing, selection/highlight state, keyboard deletion, and sketch mutation routing.
- This change builds on constraint selection routing and preview work but does not require direct geometry editing.
- No new solver math is expected.
