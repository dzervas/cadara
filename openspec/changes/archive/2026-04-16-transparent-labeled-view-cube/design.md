## Context

The viewport currently renders a separate Three.js scene into the top-right `view-cube` overlay inside `src/components/cad/three-cad-viewport.tsx`. That overlay is visually treated like a panel today: it has a background, border, shadow, and a solid six-material cube mesh that only supports face clicks. Camera snapping itself is already centralized in `src/domain/workspace/view-navigation.ts`, and the viewport already guards scene picking when the pointer is inside the cube overlay.

This change is a targeted redesign of that existing navigation affordance. It needs to preserve the current camera-control ownership and picking boundaries while changing the cube’s rendering and expanding click targets from six faces to both faces and corners.

## Goals / Non-Goals

**Goals:**
- Replace the current solid cube presentation with a transparent orientation model that does not add a panel background over the viewport.
- Show stable centered labels for the six major faces so orientation is readable at a glance.
- Support clickable corner targets for isometric camera snaps in addition to the existing face snaps.
- Reuse the shared viewport camera navigation helper path so face and corner clicks stay consistent.

**Non-Goals:**
- Rewriting the viewport around a different orientation gizmo library.
- Adding animated camera transitions, hover tooltips, or selection state to the cube in this change.
- Changing orbit-control bindings, viewport layout, or non-cube camera framing behavior.

## Decisions

### Keep the existing overlay-mounted mini scene and restyle it instead of replacing the navigation stack

The smallest change is to keep the existing `viewCubeRef` mount point and dedicated renderer, but remove the panel-style wrapper classes and replace the solid box mesh with explicit cube geometry for edges, transparent face targets, and corner targets. This keeps the current pointer-isolation behavior and avoids coupling the view cube redesign to the larger viewport runtime.

Alternative considered:
- Replace the cube with drei orientation helpers or a DOM-only control layer. Rejected because the current viewport already owns a working custom overlay, and the requested transparent/button-like presentation is more specific than the stock helper behavior.

### Represent interaction targets separately from visible chrome

Face and corner buttons should read as transparent targets rather than filled solids. The implementation should therefore separate:
- visible geometry: edge lines, subtle target outlines, and face labels
- hit geometry: invisible or near-invisible planes/sprites/meshes used only for raycasting

This avoids making the cube look opaque just to keep it clickable, and it gives the renderer freedom to show only the far-frame lines plus minimal target outlines.

Alternative considered:
- Use a single partially transparent mesh for both appearance and interaction. Rejected because it makes the cube read as a tinted volume instead of a transparent navigation aid.

### Extend shared view navigation from face vectors to named snap presets

The existing `snapCameraToVector` helper already handles camera placement for principal directions. The change should extend the shared navigation layer with a small set of named presets or vectors for:
- six orthographic face views
- eight cube-corner isometric views

The overlay renderer should map clicked face/corner targets to those shared presets instead of embedding camera math inside the component.

Alternative considered:
- Compute corner camera positions directly in the view-cube effect. Rejected because that would split face and corner navigation logic across UI and domain layers.

### Render face labels as camera-facing text anchored to each face center

Each face needs a clear centered label such as `Front`, `Top`, or `Left`. The labels should be authored once per face and rendered as camera-facing text in the cube scene so they rotate with the cube and stay centered over the intended face target.

Alternative considered:
- Use static HTML labels overlaid around the cube. Rejected because those labels would not track cube rotation and would create ambiguous mappings once the main viewport camera changes.

## Risks / Trade-offs

- [Transparent targets become too subtle against the dark viewport] → Mitigate with edge contrast, restrained face-outline strokes, and label styling that stays legible without adding a background fill.
- [Corner hit areas are hard to click at small overlay sizes] → Mitigate by using larger invisible hit geometry than the visible corner marker.
- [Face or corner labels appear mirrored or occluded from some orientations] → Mitigate by using camera-facing text sprites/planes and by limiting visible labels to outward-facing faces if needed.
- [The inline effect in `three-cad-viewport.tsx` becomes harder to follow] → Mitigate by extracting cube-scene construction and snap-preset definitions into small local helpers or domain utilities instead of growing the existing effect body.
