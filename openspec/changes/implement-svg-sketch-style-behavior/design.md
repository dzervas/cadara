## Context

Sketch style data and patch helpers already exist for fill mode/color, gradient colors, stroke enabled/color/width/cap/join. The toolbar exposes a richer SVG-style group, including miter and dash options, but tool activation is currently passive and the style panel is only reachable through selected edit-target presentation. The result is a visible toolbar surface that does not map cleanly to user actions.

## Goals / Non-Goals

**Goals:**
- Make every SVG/style toolbar entry open or apply the relevant sketch style behavior.
- Preserve the active sketch session and selected geometry while style controls are used.
- Persist authored local styles on sketch points/entities and render them in active sketch display and after re-entry.
- Add missing optional style fields for miter and dash behavior if needed.

**Non-Goals:**
- Change model feature generation, region extraction, or kernel geometry.
- Implement document-wide style libraries or named reusable style swatches.
- Implement SVG file import/export.
- Implement styling for projected reference geometry unless it already uses existing display style records.

## Decisions

### Treat SVG tools as style-panel commands

Activating `fill`, `stroke`, `fillType`, `strokeOptions`, or a style variant should keep the sketch session active and focus the relevant style control group for the current selected sketch entity or point. If no supported target is selected, the command should show target guidance instead of changing document state.

Alternative considered: make toolbar variants immediately apply hardcoded defaults. Rejected because users need inspectable controls and accidental one-click style changes are hard to undo visually.

### Keep style patches in the sketch session path

Style controls should emit the existing `sketch.toolPatched` style patch shape where possible. New fields for miter and dash should extend the same patch parser and sketch style schema rather than adding a second style mutation channel.

Alternative considered: create a separate feature-form-style pipeline. Rejected because sketch style is part of sketch authoring state and already has a focused patch path.

### Render authored styles through sketch display helpers

Viewport rendering should consume normalized sketch display style from the sketch session/renderable layer. UI controls should not create Three.js materials or rendering-specific objects.

Alternative considered: special-case style rendering in `SketchToolPanel`. Rejected because rendering belongs in viewport display helpers, not form controls.

## Risks / Trade-offs

- [Style controls can appear without a valid selection] -> disable or show selection guidance until a local sketch point/entity target is selected.
- [Dash and miter fields may not map perfectly to Three.js line rendering] -> persist the authored values and render the subset supported by current materials, with tests for supported behavior.
- [Gradient fill may not apply to line-only geometry] -> allow the style to persist but render fallback fill behavior only where a fillable display primitive exists.
- [Toolbar active state can drift from panel state] -> derive active state from editor/session style-panel focus rather than independent React local state.

## Migration Plan

1. Add style-panel focus state for fill/stroke/style variants while preserving `editingSketch`.
2. Extend sketch style schema, runtime parser, and patch helpers for miter/dash if required.
3. Wire SVG toolbar commands to open the relevant control group or target guidance.
4. Update display material helpers to render supported local style fields consistently.
5. Add focused style/persistence/toolbar tests, then run `bun run test` and `bun run lint`.

## Open Questions

- Whether style tools should remember last-used defaults for newly drawn geometry in this change or defer default style presets.
- Whether gradient rendering should be implemented for mesh-like sketch fills immediately or stored as authored metadata until fillable sketch surfaces mature.
