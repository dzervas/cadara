## Context

Current constraint definitions primarily reference local `SketchPointId` and `SketchEntityId` records. Projected reference geometry is derived from authored external references and identified by `ProjectedSketchGeometryRef`. To preserve live references, constraints must be able to target projected geometry without copying it into local sketch entities.

## Goals / Non-Goals

**Goals:**
- Represent supported projected geometry as valid constraint targets.
- Add durable local-to-reference constraints for point-on-reference, coincident-to-projected-point, line parallel/perpendicular to projected line, and tangent relationships where solver support exists.
- Keep annotations and diagnostics tied to stable authored constraint IDs.
- Preserve invalidation behavior when referenced source geometry disappears or no longer projects.

**Non-Goals:**
- No automatic snap-to-constraint creation.
- No copied/projected construction entities.
- No profile regions from projected boundaries.
- No complete NURBS or arbitrary curve constraint support.

## Decisions

### Introduce typed reference-capable constraint operands

Constraint definitions that need external targets should use explicit operand records that distinguish local points/entities from projected geometry references. This avoids overloading local sketch IDs and makes invalidation machine-readable.

Alternative considered: create hidden local entities for projected geometry and reuse existing constraint kinds. Rejected because hidden copies would break live derivation and create unclear ownership.

### Start with local-to-reference relationships

The first implementation should constrain local editable geometry against read-only projected geometry. Reference-to-reference constraints are not useful because neither side is editable within the active sketch.

Alternative considered: allow all combinations immediately. Rejected because it expands solver cases without improving the main user workflow.

### Solver owns reference geometry evaluation

The solver receives projected reference geometry and evaluates constraints against that data. The editor only stages targets and renders previews/annotations.

## Risks / Trade-offs

- Existing constraint unions may need schema additions rather than modifications -> keep old variants intact and add new explicit variants where possible.
- Projection invalidation can make constraints unsatisfied after rebuild -> report diagnostics on the constraint and reference target instead of silently dropping constraints.
- Annotation placement against derived geometry can be ambiguous -> anchor annotations using the projected geometry returned for the active solve basis.
