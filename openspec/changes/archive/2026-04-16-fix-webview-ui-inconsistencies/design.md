## Context

The current workbench renders two overlapping plane systems: decorative origin planes from `scene-factory.ts` and renderable construction planes from the modeling snapshot. Sketch display markers are already rendered as spheres for sketch-session overlays, but durable render markers still use `THREE.PointsMaterial`, which appears as white squares in the viewport. The left sidebar no longer exposes any visibility affordance, and there is no end-to-end visibility state that can suppress renderables after a tree/object action.

The requested fix cuts across scene composition, renderable styling, and sidebar controls. The goal is not to change modeling contracts, but to make the viewport use one coherent visual language for datum planes and sketch entities while restoring interactive hide/show behavior.

## Goals / Non-Goals

**Goals:**
- Render sketch vertices as small spherical markers everywhere they appear in the viewport.
- Make datum planes visually subordinate to sketch edges by using a very transparent gray plane treatment.
- Use the authoritative seeded datum planes from snapshot/render data instead of relying on extra decorative origin-plane meshes.
- Restore a working hide/show control for selectable tree and object entries and ensure hidden items stop rendering in the viewport.

**Non-Goals:**
- Changing kernel-side construction-plane identifiers such as `construction_plane-xy`.
- Redesigning the entire feature tree or viewport interaction model.
- Introducing persisted document visibility semantics beyond what is needed for the current workbench session.

## Decisions

Use render-scene styling, not duplicate scene geometry, as the source of datum-plane appearance. The viewport already consumes authoritative renderables from the snapshot, so the clean fix is to detect seeded datum-plane constructions by target or metadata and style those renderables as transparent gray planes. This avoids maintaining parallel decorative planes that can drift from the actual selectable geometry.

Render all marker geometries with mesh-based spheres instead of point sprites. `THREE.PointsMaterial` is screen-aligned and square by default, which explains the current vertex appearance. Replacing marker renderables with sphere meshes keeps sketch-session markers and durable vertex markers visually consistent. The trade-off is a slightly higher object count, but the workbench scale is small enough that the readability win is worth it.

Keep visibility state in the UI/editor layer and filter renderables before scene construction. The sidebar already maps presentation rows to `PrimitiveRef` targets; adding a visibility map keyed by primitive reference allows both tree/object controls and viewport rendering to share one source of truth without changing modeling payloads. An alternative would be to toggle Three.js object visibility imperatively after scene creation, but filtering renderables at the React boundary is simpler and keeps rebuild logic deterministic.

Use sidebar-local affordances that work for both feature-tree and object-list rows. The missing hide/show button is a presentation gap, not a modeling one. Adding per-row toggle buttons plus visibility indicators to the existing sidebar structure restores the workflow without changing the overall layout.

## Risks / Trade-offs

- [Visibility state may be ambiguous for parent rows like features] → Mitigate by scoping the first implementation to rows with direct viewport targets and by documenting how grouped rows map to renderables.
- [Datum-plane detection could be brittle if it relies only on labels] → Mitigate by keying off construction targets/standard plane identifiers rather than presentation text.
- [Replacing point sprites with meshes increases render cost] → Mitigate by using low-segment sphere geometry and sharing materials/geometry where practical.
- [Filtering hidden items at render time can desynchronize selection state] → Mitigate by clearing or ignoring hidden selections when a target becomes invisible.
