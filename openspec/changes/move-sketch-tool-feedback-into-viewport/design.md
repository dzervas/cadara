## Context

Sketch tool schemas already expose prompts, measurements, overlays, and floating input descriptors, but current React surfaces render them as fixed panels. The next step is to make those descriptors carry enough anchor information for viewport-native rendering without moving geometry rules into React components.

## Goals / Non-Goals

**Goals:**
- Render live sketch drawing measurements at geometry-relevant positions.
- Anchor numeric input near the mouse or active geometry.
- Keep drawing-tool behavior owned by sketch tool definitions and sketch session state.
- Avoid bespoke UI branches for line, rectangle, and circle beyond generic descriptor rendering.

**Non-Goals:**
- Add direct editing of existing geometry.
- Add constraint creation previews.
- Add committed constraint annotation glyphs.
- Replace the solver or modeling boundary.

## Decisions

### Extend descriptors with sketch/world anchors

Sketch tools should declare measurement labels and floating input placement using explicit anchors, such as sketch points, line midpoints, edge offsets, or cursor anchors. The viewport renderer should project those anchors into screen space and render lightweight HTML overlays or equivalent viewport labels.

Alternative considered: let each React component infer where to put labels from tool IDs. Rejected because it would duplicate geometry-specific logic in presentational code.

### Keep panel prompts minimal or remove them for active drawing

The active tool may still need concise status text, but primary dimensions and input should live near geometry. Any remaining fixed prompt should be secondary and not duplicate the main measurement labels.

Alternative considered: keep both panel and geometry labels. Rejected because it keeps the old detached workflow and risks inconsistent values.

## Risks / Trade-offs

- [Screen-space labels can overlap geometry or each other] -> start with deterministic offsets per descriptor and add collision handling only if tests or screenshots show a real issue.
- [HTML overlays can drift from Three.js geometry] -> compute anchors from the same sketch session data and camera projection each render.
- [Per-tool exceptions can creep into React] -> test descriptor payloads and keep UI rendering generic.

## Migration Plan

1. Extend sketch tool presentation descriptors with anchored measurement and input placement.
2. Emit anchored descriptors from existing line, rectangle, and circle tools.
3. Render descriptors inside the viewport overlay layer.
4. Remove or minimize the old fixed sketch tool panel for drawing tools.

## Open Questions

- Whether dimension labels should render as HTML for editability or as Three.js text/sprites for depth-aware placement.
