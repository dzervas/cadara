## Why

Sketch authors need construction geometry for layout, constraints, and references that should not create selectable profile regions or appear as finished sketch output. The authored sketch contract already has construction flags, but the workbench does not expose a complete tool flow for toggling existing geometry, creating new construction geometry, and rendering it distinctly during sketch editing.

## What Changes

- Add a sketch-mode `construction` tool button that can be used as an existing-geometry toggle for sketch vertices/points and edges/entities.
- Allow the same button to act as a persistent construction modifier when the user activates Construction and then immediately activates another drawing tool.
- Propagate the active construction modifier into newly authored sketch geometry so line, rectangle, circle, and future sketch tool commits can create construction-only geometry.
- Render construction geometry only while editing the owning sketch, using dashed wire styling, and omit it from non-editing viewport renderables.
- Ensure construction geometry remains excluded from profile/region creation and can be toggled back to normal geometry by selecting it again with the Construction tool.
- Add focused tests covering tool activation modes, toggling existing geometry both directions, new geometry creation under the modifier, profile exclusion, and edit-only dashed rendering.

## Capabilities

### New Capabilities

- `sketch-construction-geometry`: Defines how authored sketch geometry is marked as construction, how it affects profile creation and visibility, and how it is toggled during sketch editing.

### Modified Capabilities

- `sketch-tool-definition`: Sketch tool definitions must accept construction-authoring context when committing new geometry.
- `sketch-geometry-editing`: Direct sketch selection/editing must support construction toggles for existing vertices/points and edges/entities.
- `viewport-authoring-feedback`: The viewport must render construction sketch geometry only during sketch editing and with dashed styling.
- `frontend-modeling-boundary`: Construction flag mutations must be committed through the modeling boundary while transient construction mode stays editor-owned.

## Impact

- Affected areas include sketch toolbar definitions/icons, sketch session state, sketch tool commit factories, construction toggle mutation helpers, viewport selection routing, renderable composition/styling, profile/region extraction tests, and workbench interaction tests.
- No new geometry kernel dependency is expected because construction status is authored metadata that existing profile extraction already understands.
- The change should preserve current sketch constraint behavior: construction geometry can still be selected for editing and constraints, but it does not produce profile regions.
