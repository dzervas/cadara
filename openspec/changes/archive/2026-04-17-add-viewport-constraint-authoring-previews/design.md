## Context

Constraint authoring currently has target collection and generic panel feedback, but users need visual previews in the viewport. The hard part is not drawing a line; it is making the preview communicate exactly which geometric relationship will be committed.

## Goals / Non-Goals

**Goals:**
- Show transient preview geometry for dimensions and angles.
- Disambiguate diagonal, horizontal, and vertical distance dimensions through pointer position.
- Place value input near the active reference.
- Keep preview descriptors generic and separate from committed annotation rendering.

**Non-Goals:**
- Render committed constraint icons.
- Implement direct geometry editing.
- Redesign the solver.
- Add every possible constraint type if current tools do not expose it yet.

## Decisions

### Let constraint definitions choose references, let viewport render descriptors

Constraint authoring definitions should decide which reference is active from selected targets and pointer position. The viewport should render the resulting descriptor, such as a dimension line or angle arc, without knowing the business rule for that constraint.

Alternative considered: infer reference type in the viewport renderer. Rejected because the renderer would become constraint-aware and harder to test.

### Treat preview graphics as transient authoring state

Preview dimension lines and angle arcs should exist only while a constraint operation is active. They must not be stored as durable sketch annotations or reused as committed glyphs.

Alternative considered: create temporary annotation records in the sketch document. Rejected because it blurs preview and committed state ownership.

### Use pointer proximity to choose distance reference mode

For point-to-point dimensions, the active reference should change as the pointer moves near the diagonal, horizontal, or vertical implied dimension line. The preview line must update to match the selected reference before the value is entered.

Alternative considered: require a toolbar toggle for horizontal/vertical/diagonal dimensions. Rejected for the first pass because pointer-driven disambiguation is faster and matches the requested interaction.

## Risks / Trade-offs

- [Reference switching may feel unstable near boundaries] -> add hysteresis or thresholding if tests/manual use show flicker.
- [Preview lines may be confused with committed annotations] -> use a thin transient style and keep committed icons out of this proposal.
- [Input positioning may cover the target geometry] -> anchor near the preview reference with a small offset and keep collision handling minimal.

## Migration Plan

1. Extend preview descriptor types for dimension lines, angle arcs, and anchored value input.
2. Add reference-mode selection logic to dimensional constraint authoring.
3. Render transient preview graphics in the viewport.
4. Move constraint value entry near the mouse or selected preview reference.

## Open Questions

- Whether angle references need alternate arc selection for reflex angles in the first implementation.
