## Why

Feature preview sessions currently hide or inconsistently suppress the rest of the viewport geometry, which makes it hard to maintain spatial context while authoring and creates unstable visual feedback. The viewport should keep committed geometry visible and present the preview as a clearly differentiated transient overlay instead of replacing the scene.

## What Changes

- Keep committed viewport geometry visible and styled normally while a feature preview is active.
- Render previewed feature geometry as a transient overlay with partial transparency so it is visually distinct without obscuring the model.
- Stabilize preview visibility updates so starting, updating, and clearing a preview does not flicker or temporarily blank unrelated geometry.

## Capabilities

### New Capabilities
- `feature-preview-visibility`: Viewport behavior for layering transient feature previews over committed geometry without hiding the rest of the scene.

### Modified Capabilities

## Impact

- Affected code includes feature-preview renderable assembly, viewport scene visibility and material mapping, and authoring session state that toggles preview geometry.
- Likely requires regression coverage around preview lifecycle transitions and render-style behavior for committed versus transient geometry.
- Does not change modeling-kernel output, document persistence, or feature definition contracts.
