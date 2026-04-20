## Context

The current authored sketch graph supports `point`, `lineSegment`, `circle`, `arc`, and `spline`. This is enough for the existing draw tools and simple profile extraction, but it cannot represent ellipse, elliptical arc, conic, Bezier, or profile-generating text as first-class authored geometry. The later tool changes depend on these records being durable, selectable, serializable, renderable, and consumable by profile extraction.

## Goals / Non-Goals

**Goals:**
- Add explicit authored entity records for ellipse, elliptical arc, conic, Bezier curve, and profile-generating text.
- Preserve references to defining points and parameters in the sketch graph rather than flattening entities into generated line/arc/spline fragments.
- Extend validation, runtime schemas, snapshots, rendering, profile extraction, persistence, and history to round-trip the new records.
- Return explicit diagnostics for valid contract shapes that a first implementation cannot yet solve or profile.

**Non-Goals:**
- Add toolbar tools for authoring these entities. That belongs to `add-sketch-advanced-curve-text-tools`.
- Add sketch mirror, pattern, or transform associativity. That belongs to `add-sketch-derived-transform-operators`.
- Approximate new entity kinds as legacy splines, arcs, or line segments in durable authored state.

## Decisions

1. Add first-class entity variants instead of approximation records.

   Rationale: the user explicitly wants these as first-class entities. Approximation would lose semantic intent, make later edits brittle, and make text/profile workflows hard to preserve.

   Alternative considered: store approximated splines or sampled curves. Rejected because it does not preserve entity identity, parameters, or expected upstream-style edit behavior.

2. Keep authored contracts separate from generated/profile geometry.

   Rationale: profile extraction can generate edges or outlines from text and advanced curves, but the sketch definition should remain the authoritative authored graph.

   Alternative considered: persist generated outlines next to the source entity. Rejected for this change because it creates synchronization and invalidation work before tools exist.

3. Treat unsupported solver/profile cases as diagnostics, not silent omission.

   Rationale: the project rules prohibit silencing unhandled exceptions, and sketch users need clear feedback when an entity is visible but not yet usable for a downstream operation.

## Risks / Trade-offs

- [Profile extraction for text and conics may need staged support] -> Add explicit diagnostics for unsupported profile conversion and cover supported first paths with tests.
- [Runtime schema expansion can break fixtures] -> Update shared contract examples and preserve existing entity behavior unchanged.
- [Advanced curves may need solver parameterization beyond point records] -> Start with validation and solved snapshot pass-through where possible, and add solver equations only where required by direct constraints.
- [Text profile generation may require font/path decisions] -> Keep the contract semantic and allow the implementation to choose a deterministic built-in outline path without adding a new external dependency unless necessary.

## Migration Plan

Existing sketch documents remain valid because existing entity variants are unchanged. New entity kinds should be accepted only by the new schema/runtime code after this change lands.
