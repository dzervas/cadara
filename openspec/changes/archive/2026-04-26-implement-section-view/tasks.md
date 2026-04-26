## 1. Section Runtime And Seed Selection

- [x] 1.1 Wire the `Section View` toolbar action into a real editor/workbench command flow instead of the current no-op logging path.
- [x] 1.2 Add section-view runtime state and lifecycle transitions for idle, seed collection, active manipulation, flip, and clear/cancel behavior.
- [x] 1.3 Add a section-view selection filter that accepts only planar face, closed region, and construction-plane targets.
- [x] 1.4 Implement seed-to-plane resolution for accepted targets, including sketch-plane resolution for region seeds and default retained-side selection away from the camera.

## 2. Viewport Interaction And Clipping

- [x] 2.1 Extend the viewport contract so active section-view state can be rendered and updated through explicit callbacks rather than local ad hoc state.
- [x] 2.2 Render the active section plane overlay and drag handle in the viewport.
- [x] 2.3 Implement handle dragging so primary-pointer interaction moves the section plane only along its normal and preserves existing camera behavior outside the handle.
- [x] 2.4 Apply temporary clipping to the whole currently visible model, including visible preview solids, without mutating authored geometry.

## 3. Cut Surface Rendering

- [x] 3.1 Add a frontend section-cap geometry path that derives transient cut surfaces from the currently visible mesh renderables intersected by the active section plane.
- [x] 3.2 Render cut surfaces with flat section fill and diagonal hatch lines in section-plane coordinates.
- [x] 3.3 Preserve existing shading/material treatment for retained surfaces that are not cut by the active section plane.
- [x] 3.4 Implement retained-side flipping so the clipped half, cap surfaces, and hatch rendering all update from the same section-plane position.

## 4. Tests And Verification

- [x] 4.1 Add or update runtime/state tests covering tool activation, accepted seed types, invalid seed rejection, active-state transitions, flip behavior, and clear/cancel cleanup.
- [x] 4.2 Add or update viewport interaction tests covering section-handle dragging, normal-constrained movement, and preservation of non-handle camera gestures.
- [x] 4.3 Add or update viewport/rendering tests covering whole-visible-model clipping, cut-face hatch/fill treatment, and preserved shading on uncut retained surfaces.
- [x] 4.4 Run `bun run test`.
- [x] 4.5 Run `bun run lint`.
- [x] 4.6 Run `bun run build`.
