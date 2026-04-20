## Context

The sketch tool architecture already resolves each draw tool from a dedicated module with metadata, pointer lifecycle, staged entities, validation, presentation, and commit contribution. Current tools cover line, rectangle, circle, and fit-point spline. This change adds constructor variants that can be expressed with current durable entities: points, line segments, circles, arcs, and polygon line loops.

## Goals / Non-Goals

**Goals:**
- Add constructor tools for point, midpoint line, center-point rectangle, aligned rectangle, 3-point circle, 3-point arc, tangent arc, center-point arc, inscribed polygon, and circumscribed polygon.
- Add durable constraints/dimensions that preserve constructor intent after later edits.
- Keep each tool in its own module and use generic sketch tool presentation surfaces.
- Add toolbar dropdown families for related constructor variants.

**Non-Goals:**
- Add ellipse, conic, Bezier, or text authoring.
- Add sketch edit operators such as fillet/chamfer/extend/split/slot.
- Add associative mirror, pattern, or transform behavior.

## Decisions

1. Constructor variants use current entities plus constraints.

   Rationale: these tools can be represented with existing point, line, circle, and arc entities. Durable constraints are the important addition, not new entity kinds.

2. Midpoint line commits symmetric endpoints and a durable midpoint relation.

   Rationale: the desired behavior is a line sketched from its midpoint symmetrically, so the midpoint must remain meaningful after edits.

3. Aligned rectangle commits four line entities with parallel, perpendicular, equal/opposite, and corner coincident relationships as needed.

   Rationale: an aligned rectangle is not necessarily axis-aligned, so horizontal/vertical constraints are not sufficient.

4. Polygon tools commit line loops rather than a new polygon entity.

   Rationale: the durable sketch graph already handles line loops and profile extraction. A separate polygon entity would add schema surface without a confirmed need.

## Risks / Trade-offs

- [Constraint over-authoring can overconstrain sketches] -> Add only constraints required to preserve constructor intent and cover solver status in tests.
- [Multi-step arc/circle interactions differ from current two-point helper flow] -> Reuse the spline-style multi-point lifecycle pattern instead of adding shared switches.
- [Toolbar could become crowded] -> Use dropdown families for variants and keep top-level toolbar sections compact.
- [Snap-derived constraints may duplicate explicit constructor constraints] -> Deduplicate or avoid duplicate relationships during commit.
