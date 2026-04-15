## Why

The current viewport view cube is a solid boxed overlay with a tinted background, which conflicts with the intended CAD-style navigation affordance. We need a transparent, labeled navigation cube whose visible edges and clickable face and corner targets communicate orientation without adding another opaque panel over the scene.

## What Changes

- Replace the current solid view cube overlay with a transparent orientation model that has no background panel.
- Render each major face with a centered orientation label such as `Front`, `Back`, `Left`, `Right`, `Top`, and `Bottom`.
- Keep the cube visually transparent except for the far edges and target outlines so face and corner hit areas read as buttons without filling the viewport overlay.
- Add clickable corner targets that snap the camera to the matching isometric corner view.
- Preserve the existing camera snap integration through the shared viewport navigation helpers instead of introducing a second camera-control path.

## Capabilities

### New Capabilities
- `viewport-view-cube-navigation`: The viewport exposes a transparent labeled navigation cube with face and corner snap targets.

### Modified Capabilities

## Impact

- Affected code includes `src/components/cad/three-cad-viewport.tsx`, `src/domain/workspace/view-navigation.ts`, and viewport navigation tests.
- Likely requires extracting the current inline view-cube renderer into smaller helpers or components so face and corner target geometry stays readable and testable.
- Preserves existing orbit-control ownership, viewport picking guards, and the current top-right overlay placement.
