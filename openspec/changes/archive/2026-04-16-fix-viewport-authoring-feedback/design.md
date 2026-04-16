## Context

The viewport already distinguishes several renderable roles, but the current material and interaction mapping is inconsistent. Faces and regions appear with lighting and tint combinations that do not match their authoring meaning, vertex markers read too large relative to edges, and some durable edge or wire targets are not reliably hoverable or selectable. These issues create a single UX problem at the render/picking layer even though they show up as separate symptoms.

## Goals / Non-Goals

**Goals:**

- Give solids, regions, edges, and vertices a clear and stable visual language.
- Make edge, line, and vertex hover/selection reliable and consistent.
- Keep hover feedback visible but mild enough for CAD-style work.

**Non-Goals:**

- Changing document, kernel, or modeling-service semantics.
- Redesigning tool flows or viewport camera controls.
- Introducing a new selection model beyond fixing current target reliability.

## Decisions

### Style renderables by semantic role and interaction state

Renderable appearance should be derived from semantic role rather than ad hoc material defaults. Solid faces use an opaque off-white treatment, region fills use a faint cyan treatment, and wire entities share one neutral base color. Vertex markers should reuse the wire color and be scaled down so they support selection without dominating the scene.

This is preferable to tweaking lights or per-mesh exceptions because the issue is consistency across categories, not only one bad material.

### Use one interaction-color accent for hoverable wire entities

Hovered lines, edges, and vertices should all use the same mild orange accent. That keeps feedback legible while avoiding multiple competing highlight colors for closely related selectable topology.

This is preferable to role-specific hover palettes because the user intent is the same across these entities: they are active pick targets.

### Fix picking on the actual bound render objects

Edge and line interaction must resolve through the same bound scene objects used for rendering and highlight, with durable target bindings preserved through hover and selection. The implementation should avoid relying on disconnected helper objects unless a renderable cannot raycast directly.

This is preferable to overlay-only picking because helper-only interactions drift from the visible object graph and make selection bugs harder to diagnose.

## Risks / Trade-offs

- [A unified hover accent could make selected and hovered states feel too similar] → Mitigate by keeping persistent selection styling distinct if the existing interaction model already uses it.
- [Smaller vertices may become harder to hit] → Mitigate by reducing only the visible marker size while preserving an adequate pick radius if needed.
- [Edge picking fixes may touch both scene assembly and interaction code] → Mitigate by testing hover and selection against the same binding path.
