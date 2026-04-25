## Context

The Dimension tool currently uses one distance-oriented value spec and then infers target intent late during preview and commit. That works for several distance cases, but it makes non-parallel line dimensions inherit distance-oriented value-entry copy and value units even though the committed record is `lineAngle`. The viewport also requires a separate placement pinning step before rendering the floating input, so click routing must stay reliable after the final target selection.

Committed annotation descriptors already separate compact visible labels from accessible detail text. The remaining label issue is mostly formatting and glyph classification, not durable schema shape.

## Decisions

1. Add a small shared dimension-intent classifier in the sketch constraint registry.

   The classifier should inspect selected targets and return one of the supported dimension intents, including `lineLength` for one local line segment and `lineAngle` for two non-parallel lines. Preview, floating value-entry metadata, and commit should all consume that intent instead of re-deriving user-facing labels separately.

2. Keep angle UI values in degrees and durable angle values in radians.

   New angle dimensions should show `Angle` with `deg` in the floating input. Commit converts degrees to radians for `lineAngle.valueRadians`. Reopened committed angle dimensions should also show/edit degrees and convert back to radians on save.

3. Add a durable line-length dimension for single-edge authoring.

   A single selected local line should commit a `lineLength` dimension that references the line entity, not only its endpoint points. That preserves dependency cleanup when the edge is deleted and lets committed annotations highlight the edge.

4. Pin dimension placement from normal viewport clicks while awaiting value.

   Once a dimension has enough targets and is waiting for value placement, a primary viewport release should call `pinSketchConstraintPreview` with the projected sketch point regardless of whether the click lands on empty space or selectable geometry. Preview drag handles keep routing through placement patches.

5. Update labels at descriptor boundaries, not schema names.

   Durable schema discriminants such as `horizontalDistance`, `verticalDistance`, and `distance.axis` remain unchanged. User-facing annotation detail should use current CAD terms and units without exposing internal directional role labels.

## Risks

- Changing angle value units could double-convert existing committed edits if only part of the edit path changes. Tests must cover both new authoring and committed annotation editing.
- Routing placement clicks before selection can affect target collection. One selected line remains allowed to accept a second target; otherwise ready value-backed dimensions pin placement before selecting a new target.
