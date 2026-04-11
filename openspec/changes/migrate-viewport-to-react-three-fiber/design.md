## Context

The current viewport implementation in `three-cad-viewport.tsx` manually creates and disposes the WebGL renderers, camera, controls, animation loop, resize handling, gizmo renderer, and pointer-event wiring. Picking and highlight behavior are layered on top through custom scene assembly helpers. This works, but much of the code is runtime plumbing rather than product-specific CAD logic.

The intended migration is architectural rather than behavioral. The viewport must continue to render the same document-owned and sketch-owned geometry, dispatch the same editor-facing interactions, and preserve the current split between presentational components and domain contracts.

## Goals / Non-Goals

**Goals:**
- Move viewport rendering lifecycle to React Three Fiber.
- Replace hand-managed controls, grid, and orientation-gizmo wiring with drei where it provides direct parity.
- Preserve existing hover, selection, sketch-plane projection, and camera-framing behavior.
- Keep renderable contracts and editor/domain event boundaries stable during the migration.

**Non-Goals:**
- Redesigning viewport visuals or interaction semantics.
- Changing modeling-service payloads, sketch-session contracts, or kernel output formats.
- Rewriting the CAD/domain logic that derives renderables or selection targets.
- Introducing unrelated viewport features such as new shading modes or animation systems.

## Decisions

### Use React Three Fiber for renderer, scene, and camera lifecycle

The viewport should move from imperative renderer setup to an R3F `Canvas`-owned lifecycle. This removes a large amount of manual setup and cleanup code and makes scene composition more local and testable.

This is preferable to retaining the current imperative runtime because the current code spends substantial effort recreating lifecycle behavior that the library already standardizes.

### Use drei only for primitives that replace infrastructure, not CAD semantics

The migration should adopt drei for controls, grid, and orientation gizmos where the library directly replaces custom runtime glue. CAD-specific semantics such as pick-target resolution, selection filtering, sketch-plane projection, and highlight rules should remain in project code.

This is preferable to a full rewrite around library abstractions because the custom logic is the product behavior and should remain explicit.

### Preserve the renderable contract and adapt it into declarative scene nodes

`ViewportRenderableRecord` and sketch display renderables should remain the source input for the viewport. The migration should add an adapter layer that maps these records into R3F scene components instead of changing the upstream render/export contracts.

This is preferable to redesigning render contracts during the same change because it isolates migration risk to the viewport layer.

### Keep picking semantics project-owned while moving raycast wiring into the R3F scene

The project should continue to own durable target binding, selection filtering, and hover-resolution rules. The new runtime may use R3F event handling and scene composition, but the mapping from scene hit to editor target should remain project-owned.

This is preferable to adopting opaque library-level selection behavior because the workbench already depends on typed CAD-aware selection semantics.

### Migrate in parity-first slices

The safest order is:
1. Stand up an R3F viewport shell with preserved camera defaults and static scene content.
2. Port document renderables and sketch display renderables into declarative scene components.
3. Reconnect hover, selection, and sketch-plane pointer projection.
4. Replace the custom gizmo and controls with drei-backed equivalents.
5. Remove the old imperative runtime after parity tests pass.

This is preferable to a single rewrite because it keeps the migration observable and reversible.

## Risks / Trade-offs

- [Library primitives may not exactly match current view-cube or control feel] → Mitigate by preserving current camera targets, damping, mouse-button mappings, and framing helpers, and by allowing a thin compatibility wrapper around drei components.
- [R3F event handling may behave differently from current DOM-level pointer wiring] → Mitigate by keeping project-owned target resolution and by adding focused coverage for hover, select, and sketch draw interactions.
- [Declarative scene decomposition can spread logic across more files] → Mitigate by centralizing runtime adapters and keeping domain logic in existing workspace/editor modules.
- [Migration could accidentally couple presentational components to CAD contracts] → Mitigate by preserving the current boundary where viewport inputs are renderables and callbacks, not kernel logic.

## Migration Plan

1. Add `@react-three/fiber` and `@react-three/drei` and introduce an R3F-backed viewport shell behind the existing component boundary.
2. Port document and sketch renderables into declarative scene components while preserving the existing renderable input types.
3. Reconnect hover, selection, and sketch projection flows, then validate parity with viewport-focused tests.
4. Switch orientation gizmo, controls, and grid helpers to drei-backed implementations with compatibility wrappers where needed.
5. Remove obsolete imperative renderer and gizmo lifecycle code once parity coverage passes.

## Open Questions

- Whether the orientation cube should use drei’s built-in gizmo components directly or a thin custom wrapper for exact current visuals.
- Whether accelerated raycasting should be introduced in the same change or deferred until after parity is established.
