## 1. Style Contract And Patch Support

- [x] 1.1 Extend sketch style types and runtime schemas for any missing advertised fields, including miter and dash behavior.
- [x] 1.2 Extend style patch parsing and sketch session mutation helpers for the new style fields.
- [x] 1.3 Add backward-compatible tests proving existing style records still parse and render.

## 2. Style Tool Activation

- [x] 2.1 Add sketch-domain style tool activation state for fill, stroke, fill type, stroke options, and their variants.
- [x] 2.2 Route SVG/style toolbar commands to style focus or target guidance while preserving `editingSketch`.
- [x] 2.3 Update toolbar active/disabled state to reflect styleable local sketch target availability.

## 3. Style Controls And Rendering

- [x] 3.1 Update the sketch tool presentation schema and `SketchToolPanel` rendering to support focused fill and stroke control groups.
- [x] 3.2 Wire focused style controls through `sketch.toolPatched` without adding React-owned sketch mutation logic.
- [x] 3.3 Update sketch display material helpers to render supported fill, stroke, dash, and miter behavior consistently.

## 4. Persistence And Re-entry

- [x] 4.1 Ensure local styles authored through SVG/style tools are included in sketch commit requests.
- [x] 4.2 Ensure committed styled sketches preserve style data across reload and sketch re-entry.
- [x] 4.3 Add fallback behavior for persisted style fields that the current renderer cannot display.

## 5. Tests And Verification

- [x] 5.1 Add reducer/session tests for each SVG/style toolbar command preserving sketch state and opening the right style focus.
- [x] 5.2 Add sketch style patch tests for fill, stroke, gradient, miter, and dash fields.
- [x] 5.3 Add toolbar and viewport tests for style target availability and rendered style output.
- [x] 5.4 Run `bun run test`.
- [x] 5.5 Run `bun run lint`.
