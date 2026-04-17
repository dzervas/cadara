## Context

Current sketch tools consume pointer coordinates and existing geometry selections, but there is no shared snap inference layer. Adding automatic constraints directly to tools would mix geometry inference, UI feedback, and durable mutation logic. A pure candidate engine keeps those concerns separate.

## Goals / Non-Goals

**Goals:**
- Provide deterministic snap candidates for local and projected geometry.
- Rank candidates using stable distance, priority, and active-tool rules.
- Feed snapped coordinates into live previews and accepted draw points.
- Render transient snap feedback without committing durable constraints.

**Non-Goals:**
- No durable inferred constraints.
- No user snap preference UI.
- No broad performance acceleration beyond keeping the engine pure and testable.
- No arbitrary curve support beyond existing sketch/projected geometry kinds.

## Decisions

### Build a pure sketch-domain snap resolver

The resolver should accept sketch-space geometry and pointer input and return ranked candidates. It should avoid React, Three.js object state, and modeling service dependencies.

Alternative considered: compute snaps directly in viewport pointer handlers. Rejected because that would be hard to test and reuse from drawing tools.

### Return metadata, not mutations

Snap results include candidate kind, source references, snapped point, preview label, and inferred relation metadata for later changes. They do not commit constraints in this change.

Alternative considered: have snap results immediately author constraints. Rejected because preview behavior should be validated independently before durable mutation.

### Prioritize local editable geometry over projected reference geometry

When distances are equivalent, local geometry should win for editing workflows. Projected reference geometry remains available for workflows that accept read-only reference targets.

## Risks / Trade-offs

- Too many candidates can create flicker -> use stable ranking and hysteresis around the active candidate.
- Tangent and perpendicular candidates can be ambiguous -> only emit candidates with enough source geometry and pointer context to be deterministic.
- Snap engine inputs may duplicate renderable composition -> build small geometry extraction helpers rather than coupling to viewport objects.
