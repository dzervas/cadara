## 1. Style Contract And Patch Support

- [ ] 1.1 Extend sketch style types and runtime schemas for any missing advertised fields, including miter and dash behavior.
- [ ] 1.2 Extend style patch parsing and sketch session mutation helpers for the new style fields.
- [ ] 1.3 Add backward-compatible tests proving existing style records still parse and render.

## 2. Style Tool Activation

- [ ] 2.1 Add sketch-domain style tool activation state for fill, stroke, fill type, stroke options, and their variants.
- [ ] 2.2 Route SVG/style toolbar commands to style focus or target guidance while preserving `editingSketch`.
- [ ] 2.3 Update toolbar active/disabled state to reflect styleable local sketch target availability.

## 3. Style Controls And Rendering

- [ ] 3.1 Update the sketch tool presentation schema and `SketchToolPanel` rendering to support focused fill and stroke control groups.
- [ ] 3.2 Wire focused style controls through `sketch.toolPatched` without adding React-owned sketch mutation logic.
- [ ] 3.3 Update sketch display material helpers to render supported fill, stroke, dash, and miter behavior consistently.

## 4. Persistence And Re-entry

- [ ] 4.1 Ensure local styles authored through SVG/style tools are included in sketch commit requests.
- [ ] 4.2 Ensure committed styled sketches preserve style data across reload and sketch re-entry.
- [ ] 4.3 Add fallback behavior for persisted style fields that the current renderer cannot display.

## 5. Tests And Verification

- [ ] 5.1 Add reducer/session tests for each SVG/style toolbar command preserving sketch state and opening the right style focus.
- [ ] 5.2 Add sketch style patch tests for fill, stroke, gradient, miter, and dash fields.
- [ ] 5.3 Add toolbar and viewport tests for style target availability and rendered style output.
- [ ] 5.4 Run `bun run test`.
- [ ] 5.5 Run `bun run lint`.
