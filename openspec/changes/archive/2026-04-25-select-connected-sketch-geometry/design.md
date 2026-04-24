## Context

Active sketch editing already stores selected primitive references in editor state and routes viewport clicks through the shared `viewport.selectionRequested` event. Local sketch entities render with durable `sketchEntity` targets, while projected reference geometry and annotations have separate target kinds. This change extends active sketch selection behavior without changing the sketch graph, solver input, or operation history.

## Goals / Non-Goals

**Goals:**

- Allow a double-click on an editable local sketch entity to select every editable local sketch entity connected through shared sketch points.
- Keep the connected selection derived from the active sketch definition so rectangle, line-chain, and manually constrained geometry all follow the same rule.
- Preserve existing single-click, drag-edit, delete, construction toggle, style, projected reference, and annotation behavior.
- Keep the implementation testable in domain/editor state tests before relying on viewport integration coverage.

**Non-Goals:**

- Selecting by authoring operation metadata such as "rectangle operation".
- Selecting connected projected reference geometry.
- Inferring connectivity from coincident constraints between distinct point records.
- Changing persistence schemas, solver behavior, region extraction, or sketch commit payloads.

## Decisions

1. Derive connectivity from shared point ids in the active sketch definition.

   Local sketch entities already reference their defining point records. A graph walk from the double-clicked entity through shared point ids gives deterministic connected components and naturally handles open chains, branching chains, and closed loops. This avoids relying on constructor metadata, which is historical and not the source of truth for current geometry.

   Alternative considered: use authoring operations to recognize rectangles and constructor-created shapes. Rejected because operation metadata can be stale or absent, and the flat sketch graph is the current source of truth for rendering, picking, and selection.

2. Treat expansion as a selection action owned by editor state, with the viewport only identifying the double-click target.

   The viewport should dispatch a distinct selection intent for double-clicks on picked sketch geometry, while the editor/domain layer decides whether it can expand that target. This keeps event routing separate from sketch graph traversal and lets tests cover the behavior without a Three.js scene.

   Alternative considered: compute connected targets in the viewport from renderables. Rejected because renderables are display output and may omit domain-only details needed for stable connectivity.

3. Expand only editable local sketch entity targets.

   Points, annotations, projected references, regions, and non-sketch targets should keep their current behavior. A double-click on unsupported targets should fall back to existing selection behavior or be ignored according to the current route, rather than guessing a connected set.

   Alternative considered: include points in the expanded selection. Rejected for this change because the user examples concern continued edge/curve geometry, and existing delete/drag behavior can treat point selection differently from entity selection.

## Risks / Trade-offs

- [Branching sketches select more geometry than expected] -> Document and test that the full connected component is selected; this is predictable and avoids ambiguous chain direction choices.
- [Double-click may conflict with direct drag or annotation double-click editing] -> Gate expansion to editable local sketch entity targets and leave annotation double-click handling unchanged.
- [Large sketches could make selection expansion expensive] -> Use a linear graph walk over the active definition's entities and point adjacency; no scene traversal or solver work is needed.
- [Connected by coincident constraint but not shared point id is excluded] -> Keep this as an explicit non-goal so connectivity matches the current graph topology rather than solved geometric coincidence.
