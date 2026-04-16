## 1. Viewport Marker And Plane Rendering

- [x] 1.1 Replace durable marker renderables that currently use point sprites with shared sphere-mesh rendering so sketch vertices and topology vertices appear as small spheres.
- [x] 1.2 Detect authoritative seeded datum plane renderables and apply transparent gray plane styling that stays distinct from sketch edges.
- [x] 1.3 Remove or disable duplicate decorative origin-plane meshes when authoritative `construction_plane-*` datum renderables are present in the viewport scene.

## 2. Visibility Controls

- [x] 2.1 Add workbench visibility state keyed by sidebar/viewport targets and filter hidden renderables before scene construction.
- [x] 2.2 Restore per-row hide/show controls in the feature tree and parts/objects sections, including visible hidden-state feedback.
- [x] 2.3 Ensure hiding a target updates hover/selection behavior safely so hidden items do not remain interactable.

## 3. Verification

- [x] 3.1 Add or update tests covering datum-plane render styling and marker object construction in the workspace render helpers.
- [x] 3.2 Verify in the browser that sketch points render as spheres, datum planes are transparent gray, the seeded origin planes are the ones displayed, and hide/show toggles immediately affect viewport rendering.
