## Context

The workbench viewport is rendered by `src/components/cad/three-cad-viewport.tsx` with React Three Fiber, drei `OrbitControls`, and a custom top-right view cube overlay. The current active viewport camera is assumed to be `THREE.PerspectiveCamera` in several helpers, including view snapping, sketch camera framing, and viewport frame capture/restore.

The new control should be a small viewport overlay near the view cube, not a toolbar tool. The project uses Mantine as the primary UI primitive library, so the dropdown should use Mantine menu/action primitives where they keep the implementation compact and consistent with the shell.

## Goals / Non-Goals

**Goals:**

- Start the viewport in orthographic projection.
- Add a projection dropdown under and right-aligned with the view cube, using `public/icons/view-cube.svg` as the trigger icon.
- Switch between orthographic and perspective projection without changing the current view target, up vector, or view direction.
- Preserve picking, orbit/pan controls, view-cube snapping, sketch pointer projection, and sketch camera framing across projection modes.

**Non-Goals:**

- Redesign the view cube geometry, labels, or principal/isometric view presets.
- Add persisted user preferences for projection mode.
- Add new camera animation controls or alter orbit-control mouse bindings.
- Change sketch/modeling projection semantics; this is only about viewport camera projection.

## Decisions

1. Keep projection mode as local viewport UI state.

   Projection mode is a display preference for the active viewport and does not need to enter document state or tool-action contracts. A local `ViewportProjectionMode` union keeps the change scoped and avoids adding persistence behavior that was not requested.

   Alternative considered: store the setting in editor runtime state. That would make sense only if projection mode needs persistence, multi-viewport coordination, or file serialization.

2. Generalize viewport camera helpers to the active camera type.

   Introduce or reuse a narrow camera type that covers `THREE.PerspectiveCamera | THREE.OrthographicCamera`, then update helper signatures that only require `position`, `up`, `lookAt`, and projection matrices. Perspective-specific math should remain isolated to helpers that actually need field-of-view calculations.

   Alternative considered: keep a perspective-only code path and add a separate orthographic branch inside the component. That would duplicate navigation and framing behavior and increase the chance of mode-specific regressions.

3. Preserve camera frame when switching projection.

   When the user changes projection, capture the active camera position, up vector, and orbit target, create or activate the new camera projection, then apply the captured frame and refresh controls. This keeps the visible orientation stable while only changing the projection model.

   Alternative considered: reset to the default camera on every mode switch. That is simpler, but it loses user context and makes the dropdown feel destructive.

4. Fit orthographic sketch framing with zoom instead of distance.

   Existing sketch framing computes a perspective distance from field of view. Orthographic framing should set the camera view/zoom to cover the computed sketch extents, while still positioning the camera along the sketch-plane normal so controls and view-cube orientation remain coherent.

   Alternative considered: approximate orthographic framing by changing only camera distance. Orthographic scale is driven by zoom/frustum, so distance-only framing would not reliably fit sketch content.

5. Keep the dropdown as a viewport overlay sibling of the view cube.

   The control should be absolutely positioned in the same viewport overlay layer as the cube, right-aligned and placed below it. The trigger should use the provided SVG icon, with accessible labeling and a compact menu for `Orthographic` and `Perspective`.

   Alternative considered: add the projection mode to the top toolbar. The user specifically asked for the control under and on the right of the cube, and colocating it with view navigation keeps camera-view concerns together.

## Risks / Trade-offs

- [Camera helper type widening can expose perspective-only assumptions] -> Mitigate by adding focused unit tests for view snapping and sketch camera framing in both projection modes.
- [Projection switching can desynchronize drei `OrbitControls` from the active camera] -> Mitigate by updating the default camera and controls together, then calling `controls.update()`.
- [Orthographic default can change existing visual snapshots or e2e expectations] -> Mitigate by updating viewport tests to assert the new default explicitly.
- [The overlay can overlap sketch annotations or notifications on small viewports] -> Mitigate by reusing the existing view-cube sizing/offset constants and verifying desktop/mobile layout.
