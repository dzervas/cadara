## Context

Sketch constraint authoring already routes tools through `src/domain/sketch-constraints/`, stores durable dimensions in `DimensionDefinition`, and renders transient dimension previews through generic `dimensionLine` and `angleArc` overlay descriptors. The current dimension contract is mostly point-distance and circle-radius oriented; it does not yet express diameter, line/edge distance operands, angular dimensions, or user-controlled annotation placement.

This design treats "edge" as a sketch-space line reference: a local sketch line segment, or a projected reference line only when the existing projected-reference path supplies sketch-plane geometry. Dimensioning arbitrary 3D model edges without projection is out of scope for this change.

## Goals / Non-Goals

**Goals:**

- Support diameter dimensions for local circles and arcs.
- Support distance dimensions between two sketch-space line references and between a line reference and a point/vertex.
- Support angle dimensions between two non-parallel sketch-space line references.
- Let users place pending linear, diameter, and angle annotations by dragging the preview dimension line or angle arc before accepting the value.
- Persist enough annotation placement data on durable dimensions to reproduce committed annotation placement after solve/reload.
- Keep preview placement in the editor layer, dimension records in the sketch document contract, and numeric evaluation in the sketch solver.

**Non-Goals:**

- Dimensioning arbitrary 3D topology targets that have not been projected into the active sketch plane.
- A full annotation editing system for already committed dimensions beyond preserving and rendering the initial placement.
- New visual styling or a replacement for existing sketch overlay components.
- Support for angle dimensions on parallel or degenerate line pairs.

## Decisions

1. Extend the existing Dimension tool family instead of adding separate one-off tools.

   The operation should infer dimension kind from selected target kinds: circle/arc selects diameter, point/point keeps existing distance behavior, line/line creates either distance or angle depending on the active dimension mode/preview intent, and line/point creates perpendicular distance. This matches the current constraint registry pattern where target resolvers and commit contribution builders own operation-specific rules.

   Alternative considered: add dedicated toolbar tools for diameter, edge distance, and angle dimensions. That would be more explicit but increases toolbar surface area and duplicates the same selection/value-entry lifecycle.

2. Add durable dimension operand variants rather than encoding line dimensions as hidden point dimensions.

   `DimensionDefinition` should gain explicit variants for circle/arc diameter, line-line distance, line-point distance, and line-line angle. These variants should store stable local entity/point IDs or projected geometry operands where projected references are supported. The solver then evaluates the intended relationship directly instead of relying on synthetic helper points that could drift from the selected geometry.

   Alternative considered: create temporary construction points and reuse point-to-point dimensions. That makes persistence smaller but obscures user intent, complicates dependency cleanup, and creates extra graph members unrelated to the user's selection.

3. Store annotation placement as dimension presentation metadata owned by the durable dimension.

   Linear and diameter dimensions should persist a sketch-plane placement descriptor such as reference kind plus signed offset or explicit dimension-line anchor. Angle dimensions should persist the chosen arc radius and side/orientation relative to the two line references. The renderer can derive exact line/arc endpoints from solved geometry plus this placement metadata.

   Alternative considered: store final screen coordinates. Screen coordinates break on camera changes and reloads, while sketch-plane placement remains tied to the authored geometry.

4. Treat draggable preview geometry as editor-owned draft state until commit.

   The active constraint-authoring state should track placement separately from the numeric value. Dragging a `dimensionLine` updates the draft offset/anchor; dragging an `angleArc` updates the draft arc radius/side. Accepting the value commits both the dimension value and placement metadata; cancelling discards both.

   Alternative considered: commit the dimension first and then edit placement as a second operation. That creates an avoidable intermediate document mutation and does not match the user's need to define the annotation while creating the dimension.

5. Reuse and extend generic overlay descriptors for hit-tested drag handles.

   `dimensionLine` and `angleArc` descriptors should gain optional drag metadata or a stable handle ID so the viewport layer can route pointer drags back through the sketch presentation patch path. The renderer should not know the operation-specific dimension rules; it should only expose drag gestures on declared overlay geometry.

   Alternative considered: build operation-specific React branches for dimension dragging. That would be faster locally but violates the existing split between presentation descriptors and tool logic.

## Risks / Trade-offs

- Solver complexity for line/line distance can be ambiguous for non-parallel lines because the perpendicular distance between intersecting infinite lines is zero. Mitigation: only allow line-line distance for parallel or near-parallel line references; non-parallel line pairs create angle dimensions.
- Annotation placement can become visually stale after large geometry edits. Mitigation: derive committed annotation geometry from solved geometry plus stored sketch-plane placement, and fall back to a deterministic default when stored placement becomes degenerate.
- Projected reference support can broaden the implementation surface. Mitigation: implement local sketch targets first through shared operand helpers, then add projected references only through the existing projected geometry contract where the target kind is already supported.
- Drag handles on SVG overlays can interfere with viewport orbit/pan controls. Mitigation: keep overlay pointer capture narrow to declared draggable dimension geometry and release capture on cancel/commit.

## Migration Plan

Existing dimensions remain valid. New optional placement metadata should be defaulted during render when absent, and existing point-distance/radius dimensions should continue to solve and render with deterministic generated placement. No document migration is required unless schema validation requires a new version for added dimension variants.

Rollback is limited to not authoring the new dimension variants; existing documents containing only current dimension kinds are unaffected.
