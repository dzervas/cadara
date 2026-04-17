## Context

`SketchDefinition` already carries `referenceIds` and `references`, and the solver contract already exposes `ProjectSketchExternalReferencesRequest` / `ProjectSketchExternalReferencesResponse`. The missing product behavior is the authoring loop: selecting external sources, persisting those references on the sketch, resolving them through the solver boundary, and presenting the projected geometry as sketch-editable context without making it local sketch geometry.

The OCC implementation policy currently rejects projected geometry as profile boundary input. This change preserves that limitation; it only makes projected geometry available for display and selection during sketch editing.

## Goals / Non-Goals

**Goals:**
- Let users author durable external sketch reference records from supported model/sketch sources.
- Render successful projected references as read-only sketch reference geometry during active sketch editing.
- Make reference geometry selectable as reference targets for later workflows.
- Surface missing, unsupported, ambiguous, or out-of-plane projection diagnostics.
- Preserve reference records across commit, reload, and sketch re-entry.

**Non-Goals:**
- No automatic snapping or inferred constraints.
- No explicit constraints to projected geometry.
- No projected geometry profile boundaries.
- No copying projected geometry into local sketch-owned points or entities.
- No broad topology naming redesign.

## Decisions

### Use authored references plus solver-owned projected geometry

External geometry remains represented by `SketchReferenceDefinition` records and solver-produced `ProjectedSketchReferenceRecord` geometry. The editor must not synthesize persistent local points or entities to represent projected results.

Alternative considered: convert projection results into construction sketch entities. Rejected because it breaks the live-reference model and makes later invalidation and parametric update semantics ambiguous.

### Add editor-owned reference authoring state

Reference selection and preview state belongs in the sketch editor/session layer. Accepted reference mutations are routed through the modeling boundary, matching existing direct edit and construction mutation ownership rules.

Alternative considered: let viewport components append sketch references directly. Rejected because durable sketch mutations must stay out of React presentation components.

### Render projected geometry with a distinct read-only style

Projected reference geometry should be visible and pickable while editing the owning sketch, but it must be visually distinct from normal and construction sketch geometry. It should not participate in drag editing or construction toggling.

Alternative considered: reuse construction styling. Rejected because construction geometry is sketch-owned and editable, while projected reference geometry is derived and read-only.

### Keep profile extraction unchanged

Region extraction and OCC profile building continue to ignore or reject projected geometry boundaries in this change. A later change will address live-derived projected profile boundaries explicitly.

## Risks / Trade-offs

- Projection diagnostics can become noisy when source topology changes -> surface per-reference status and keep invalid references explicit instead of deleting or remapping them.
- Selection ambiguity can increase when projected and local geometry overlap -> prioritize local authored geometry for editing, and expose reference targets only to workflows that accept them.
- Solver projection is currently simplistic in adapters -> add tests around request/response routing and diagnostics so richer projection implementations can replace it behind the same contract.
- Reference authoring can be confused with Project Geometry copy behavior in other CAD tools -> use product language that emphasizes live reference geometry, not copied entities.
