## Why

SVG sketch styling currently feels unreliable because style tools can focus themselves while editing a sketch, style rendering is always present when authored, and fill/stroke options are split across too many toolbar entries. This change makes SVG styling explicit, predictable, and scoped to the sketch document data that owns it.

## What Changes

- Add a sketch-toolbar toggle that enables or disables SVG style rendering for the active sketch without deleting the sketch's saved fill/stroke style data.
- Persist the SVG style rendering toggle per sketch in the document so reopening or switching sketches restores the sketch's own setting.
- Prevent the Fill tool from opening or focusing style controls unless the user explicitly activates it.
- Limit sketch SVG toolbar tools to `Fill` and `Stroke`; move fill type controls into the Fill form and stroke options into the Stroke form.
- Make `Fill` accept only enclosed region targets produced by the real-time region solver.
- Make `Stroke` accept only edge/entity targets.
- Keep unsupported or disabled SVG rendering states non-destructive: stored styles remain saved even when rendering is off.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `svg-sketch-style-behavior`: SVG style activation, per-sketch rendering visibility, target acceptance, and persisted render behavior are changing.
- `sketch-tool-editor-schema`: style forms must expose fill type and stroke options inside the Fill and Stroke focused tool forms instead of separate style tools.
- `toolbar-tool-presentation`: the sketch toolbar must expose only the Fill and Stroke SVG tools plus a rendering toggle, with correct activation and availability states.

## Impact

- Sketch document and runtime state for persisted per-sketch SVG render visibility.
- Sketch style target selection and style patching for region fills and edge strokes.
- Tool definitions, toolbar grouping, and active tool focus behavior for SVG sketch tools.
- Generic sketch tool form schema and components that render fill/stroke controls.
- Viewport renderable generation for applying or suppressing fill/stroke visual styles without dropping authored style data.
- Focused tests for toolbar presentation, style-tool activation, target filtering, persistence, and renderable output.
