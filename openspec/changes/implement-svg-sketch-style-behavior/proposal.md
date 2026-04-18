## Why

The toolbar exposes SVG-style sketch controls, but selecting them currently does not open a coherent style workflow or cover all advertised style options. Users need fill and stroke controls to behave predictably on selected sketch geometry, persist through commit/reload, and render in the viewport.

## What Changes

- Implement sketch SVG/style toolbar behavior for `fill`, `stroke`, `fillType`, `fillSolid`, `fillGradient`, `strokeOptions`, `strokeWidth`, `strokeCap`, `strokeJoin`, `strokeMiter`, and `strokeDash`.
- Open the relevant style control surface when a style tool is selected and a supported sketch point/entity is selected.
- Apply style patches through the existing sketch tool patch flow, preserving sketch session state and commit payloads.
- Extend style data and rendering where necessary for advertised options such as miter limit and dash pattern.
- Render local sketch styles consistently in active sketch display and after sketch commit/re-entry.
- Keep SVG/style behavior scoped to sketch presentation; it does not change profile extraction, feature geometry generation, or kernel semantics.

## Capabilities

### New Capabilities

- `svg-sketch-style-behavior`: Defines sketch SVG/style authoring behavior, persistence, and viewport rendering for local sketch point/entity styles.

### Modified Capabilities

- `sketch-tool-editor-schema`: The schema must support style-focused control groups and toolbar-driven style panel selection.
- `sketch-tool-definition`: Sketch tool activation rules must distinguish style tools from drawing/edit tools while preserving active sketch sessions.
- `toolbar-tool-presentation`: SVG/style toolbar controls must advertise active/disabled state that matches available sketch style targets.

## Impact

- Affected areas include sketch style contracts and runtime schemas, sketch session style patch routing, toolbar active/disabled state, `SketchToolPanel` rendering, sketch display material mapping, persistence tests, and viewport style tests.
- This may add optional sketch style fields for miter limit and dash pattern while keeping existing style records backward compatible.
- No new runtime dependency is expected.
