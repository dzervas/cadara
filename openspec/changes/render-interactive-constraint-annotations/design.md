## Context

Committed sketch constraints already exist as durable sketch records, and there is selection/delete plumbing for annotation targets. The missing piece is viewport-native glyph placement and interaction that highlights affected geometry without confusing annotation selection with geometry selection.

## Goals / Non-Goals

**Goals:**
- Render committed constraints and dimensions as small viewport glyphs near affected geometry.
- Hit-test glyphs as annotation targets.
- Highlight affected geometry on glyph hover or annotation selection.
- Delete the selected committed annotation with Delete or Backspace.

**Non-Goals:**
- Add transient constraint previews.
- Add direct geometry editing.
- Add new constraint solver math.
- Build a full annotation layout engine.

## Decisions

### Use durable annotation descriptors as the rendering input

Committed glyphs should be generated from durable sketch constraint/dimension IDs and affected target references. The viewport should render and hit-test descriptors; it should not inspect raw constraint records to decide behavior.

Alternative considered: render a React list over the viewport. Rejected because it does not provide geometry-local glyphs or scalable hit targets.

### Highlight affected geometry without selecting it

Hovering or clicking an annotation should visually highlight affected geometry, but the selected target remains the annotation itself. This keeps Delete/Backspace semantics unambiguous.

Alternative considered: selecting an annotation also selects its geometry. Rejected because it makes deletion and future edit commands ambiguous.

## Risks / Trade-offs

- [Glyphs may overlap in dense sketches] -> start with deterministic anchors and small glyphs; defer advanced label layout until needed.
- [Annotation hit targets could interfere with geometry selection] -> prioritize explicit glyph hit targets only when the pointer is over the glyph bounds.
- [Deleting annotations could bypass durable state] -> route deletion through the existing editor/modeling sketch mutation flow.

## Migration Plan

1. Generate committed annotation descriptors with durable IDs, glyph kind, anchor, and affected geometry refs.
2. Render glyphs in the viewport with hit targets.
3. Add hover/selection highlight for affected geometry.
4. Wire Delete/Backspace to durable annotation removal.

## Open Questions

- Whether dimension annotations should use text-first glyphs while geometric constraints use icon-first glyphs in the first implementation.
