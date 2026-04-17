## Context

The snap engine identifies transient intent. This change turns accepted intent into durable authored constraints. The key product rule is that snap acceptance must preserve the relationship, not merely place coordinates.

## Goals / Non-Goals

**Goals:**
- Map accepted snap candidates to durable constraint contributions.
- Add missing constraint kinds required to represent common snap intent.
- Keep inferred constraints visible, selectable, deletable, and solver-owned like explicit constraints.
- Preserve undo/redo semantics for draw action plus inferred constraints.

**Non-Goals:**
- No preference UI for enabling/disabling each snap relation.
- No automatic repair for over-constrained sketches beyond existing diagnostics.
- No copying projected geometry into local sketch-owned geometry.
- No arbitrary higher-order inference chains.

## Decisions

### Use explicit durable constraints for accepted intent

Accepted midpoint, point-on-curve, tangent, horizontal, vertical, perpendicular, parallel, and concentric intent should be represented by durable constraint records. Coordinate placement alone is not acceptable because it loses parametric behavior.

Alternative considered: store snap metadata only in history. Rejected because solver and reload behavior need durable constraints.

### Keep inference at tool commit boundaries

Inferred constraints should be appended when the drawing/edit operation is accepted, not while the pointer is merely hovering. This avoids durable churn and keeps cancellation simple.

### Group inferred constraints with the triggering action

Sketch-local undo/redo should remove or restore the geometry and its inferred constraints together where the user experiences them as one action. If the existing history model cannot group records yet, this change should add the smallest grouping mechanism needed.

## Risks / Trade-offs

- Inference can over-constrain existing sketches -> prefer conservative mappings and report solver diagnostics rather than suppressing authored intent silently.
- Some relationships require new solver terms -> implement the smallest set needed by supported snap kinds.
- Grouped undo may touch history assumptions -> keep grouping local to accepted sketch authoring contributions.
