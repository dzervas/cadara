## Context

The sketch editor already has a durable pipeline for three related behaviors:

- local editable sketch geometry
- read-only projected external reference geometry
- constraint and dimension tools that resolve point and line targets from those sources

What is missing is a third source of reference geometry inside an active sketch session: the sketch's own origin point plus its local X and Y axes. Users currently need to draw helper geometry if they want to anchor a point at the origin, dimension to the origin, or constrain lines relative to the sketch axes.

This change crosses viewport rendering and picking, sketch-session target resolution, durable constraint or dimension storage, and solver validation or resolution. A short design is warranted so implementation does not add ad hoc per-tool exceptions.

## Goals / Non-Goals

**Goals:**
- Expose the active sketch origin point and sketch-local X and Y axes as visible, pickable, read-only datum references.
- Allow compatible existing constraint and dimension tools to consume those datum references without creating local proxy geometry.
- Keep committed constraints and dimensions against datum references durable across save, reload, rebuild, undo, and sketch re-entry.
- Preserve sketch-plane-local semantics for face-backed and non-XY sketches.

**Non-Goals:**
- Do not add brand-new constraint tool types just for origin or axis workflows.
- Do not represent the origin point or axes as authored sketch entities, construction lines, or construction points.
- Do not make datum references draggable, deletable, profile-producing, or selectable outside the intended sketch-session reference flows.
- Do not redefine existing world-space datum-plane behavior outside active sketch editing.

## Decisions

### 1. Seed implicit sketch datum references for every active sketch session

Each sketch session should expose three implicit datum references derived from the sketch plane frame:

- origin point at sketch coordinates `[0, 0]`
- sketch-local X axis
- sketch-local Y axis

These are sketch-owned references, not user-authored sketch geometry and not authored external-reference records.

**Why:** The origin and axes are inherent to the sketch plane, so they should exist for every sketch without polluting the authored sketch definition or requiring user setup.

**Alternative considered:** Auto-create hidden construction points and lines in every sketch.
**Why not:** That would blur authored geometry with editor-owned context, create deletion and history edge cases, and risk profile or construction-state side effects.

### 2. Reuse the existing reference-target pipeline instead of adding tool-specific special cases

Constraint and dimension target resolution should treat datum origin and axes as another read-only compatible point or line source, parallel to existing projected reference geometry. The implementation may share the same resolver, preview, annotation, and selection plumbing already used for projected targets, but datum references must remain distinguishable in ownership and semantics.

**Why:** Most affected tools already branch on local-versus-read-only reference targets. Reusing that path minimizes duplicated logic and keeps support broad across coincident, midpoint, perpendicular, symmetric, pierce, and dimension workflows.

**Alternative considered:** Add explicit per-tool origin or axis shortcuts.
**Why not:** That would fragment behavior, miss future tools, and make constraint support depend on bespoke UI code rather than shared target contracts.

### 3. Render finite pick handles for datum axes, but solve them as infinite sketch-local axes

The origin point should render as a pickable marker. The X and Y axes should render as finite viewport-aligned or sketch-bounds-aligned guide segments for discoverability and picking, but committed constraints and dimensions must interpret them as the infinite sketch-local axes through the origin.

**Why:** Users need something visible and clickable, but finite render length must not change the mathematical meaning of "the X axis" or "the Y axis."

**Alternative considered:** Store datum axes as ordinary finite line segments.
**Why not:** Constraint and dimension results would depend on arbitrary display extents and could become unstable as the viewport framing changes.

### 4. Persist datum-targeted constraints and dimensions through stable datum identities tied to the sketch plane

Committed records that reference the origin point or axes should store stable datum identities that can be re-resolved from the sketch plane frame during solve, annotation rebuild, and highlight resolution. Existing local-geometry cleanup rules should continue deleting only local-dependent records; datum references themselves are never deleted independently.

**Why:** The user-visible behavior must survive sketch re-entry and rebuild exactly like projected-reference-targeted constraints do.

**Alternative considered:** Keep datum references transient and re-author them on every sketch open.
**Why not:** That would make saved constraints ambiguous or impossible to reconstruct deterministically.

## Risks / Trade-offs

- **Datum references get conflated with authored external references** → Keep separate ownership semantics and labels even if some internal resolver code is shared.
- **Axis rendering becomes too subtle or too noisy** → Use distinct, subdued styling that is visible in sketch mode and highlightable on hover without competing with editable sketch geometry.
- **Support surface grows inconsistently across tools** → Limit this change to tools that already accept compatible point or line reference operands and add regression coverage for both accepted and rejected combinations.
- **Face-backed or rotated sketches accidentally use world axes** → Resolve datum references strictly from sketch-plane coordinates and add non-XY regression scenarios.

## Migration Plan

No document migration is required for existing sketches because this change only adds new selectable datum reference targets and new durable records authored after the feature ships.

Implementation rollout order:

1. Add sketch-session datum reference identities plus viewport render or pick bindings.
2. Extend target resolution and durable operand plumbing so constraints and dimensions can store datum references.
3. Update compatible constraint and dimension authoring flows to accept datum targets.
4. Add solver, annotation, and reopen regression coverage for datum-targeted records.

Rollback strategy: disable datum-target selection and reject datum-targeted commit creation while leaving existing non-datum constraint behavior untouched.

## Open Questions

- Whether the datum axes should always be shown during sketch editing or fade in only when sketch geometry or a compatible tool is active. This design assumes they are visible throughout sketch editing for discoverability.
- Whether dimension-to-axis support in the first slice should include both line-angle and perpendicular line-distance workflows, or only the subset already exercised by the current dimension authoring contract. The proposal assumes "compatible existing point/line dimension workflows" rather than inventing new dimension types.
