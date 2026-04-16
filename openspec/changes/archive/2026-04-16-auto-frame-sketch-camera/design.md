## Context

Sketch sessions already preserve a plane definition used for pointer projection and coplanar rendering. Camera behavior is currently independent from that contract, so users can enter sketch mode while looking from a non-parallel angle or at a zoom level that excludes the authored sketch.

## Goals / Non-Goals

**Goals:**
- Orient the camera to a plane-parallel sketching view whenever a sketch session opens.
- Ensure edit entry frames all existing sketch entities in view.
- Preserve consistent behavior across datum-plane and planar-face entry points.

**Non-Goals:**
- Changing orbit/pan controls after sketch entry.
- Introducing animation-timeline controls for camera transitions.
- Changing geometric sketch-plane ownership or persistence fields.

## Decisions

### Drive camera entry from the same sketch-open payload that carries plane definition

Sketch-open already receives a resolved `SketchPlaneDefinition`. Camera orientation should be derived from that definition (plane origin + normal + in-plane axes) to guarantee parity between projection math and viewport orientation.

### Compute edit framing from sketch-space bounds transformed to world space

When editing an existing sketch, compute a world-space bounds volume for committed sketch entities associated with the session, then frame the camera so all bounds are visible with margin.

For empty sketches (new or effectively empty edits), frame a default extent centered on the plane origin using a stable authored-size heuristic.

### Keep framing mode-aware but deterministic

Use a deterministic entry path:
1. Resolve plane-aligned camera orientation.
2. Resolve target bounds (`existing sketch bounds` or `default plane extent`).
3. Apply fit-to-bounds with consistent padding.

This ensures the same sketch always reopens to the same framing state unless its geometry changes.

## Risks / Trade-offs

- [Large or sparse sketches may over-zoom due to outlier geometry] → Mitigate by using robust bounds with minimum/maximum fit constraints.
- [Immediate camera snaps can feel abrupt] → Mitigate with optional short interpolation that does not delay tool readiness.
- [Plane-normal orientation ambiguity can cause flipped up-vectors] → Mitigate by normalizing up-vector selection from stored in-plane axes.
