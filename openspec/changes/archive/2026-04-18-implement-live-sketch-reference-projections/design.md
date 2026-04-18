## Context

The current codebase already has most of the external-reference authoring surface:

- `projectReference` is present in the sketch toolbar and routes to `sketchReferenceSelectionFilter`.
- `SketchDefinition` persists `referenceIds` and `references`.
- The editor machine emits `sketch.projectReferences` effects and applies `effect.sketchReferencesProjected` with `updateSketchReferenceProjection`.
- Sketch display, selection, snapping, constraints, region extraction, and OCC profile helpers can consume `ProjectedSketchReferenceRecord` data when it is supplied.

The missing behavior is source-backed projection. `SketchConstraintSolverAdapter` and `MockSketchSolverAdapter` currently return unsupported diagnostics for real model and existing-sketch references because they have no access to source topology or source sketch snapshots. As a result, references can be authored but usually do not produce useful projected geometry.

## Goals / Non-Goals

**Goals:**

- Resolve supported model vertices, linear/circular edges, planar faces, existing sketch points, and existing sketch entities into solver-owned 2D projected geometry for the active sketch plane.
- Make active editing, sketch commit, document reload, and sketch re-entry use the same projection semantics.
- Feed live projected records into validation, solve, constraint authoring, snap inference, derived region extraction, and OCC profile rebuilding.
- Keep projected geometry read-only and derived from authored references.
- Report stable projection diagnostics for missing, unsupported, ambiguous, out-of-plane, or stale references.

**Non-Goals:**

- No copy/project-as-local-sketch-entity mode.
- No broad durable topology naming redesign.
- No support for arbitrary spline/NURBS edge projection unless an existing adapter can return a typed projected geometry shape without expanding contracts.
- No automatic constraint creation beyond the already defined snap/constraint workflows.

## Decisions

### Resolve external references in the modeling/kernel layer

Projection source lookup needs access to the current document revision, topology records, OCC shapes, and existing sketch snapshots. The modeling/kernel layer should own that lookup and return `ProjectedSketchReferenceRecord` data through the existing solver projection response shape. The pure sketch solve path should continue to consume projected records as input rather than attempting document topology lookup itself.

Alternative considered: teach the standalone `SketchConstraintSolverAdapter` to resolve model topology directly. Rejected because that adapter currently receives only sketch-plane and reference records; giving it document topology would couple a pure sketch solver to kernel state.

### Use one projection path for active editing and commits

The editor effect runtime should ask the modeling service for live reference projections for the current document revision. Sketch commit/rebuild should call the same projection resolver before validation, solve, and region derivation. This avoids active editing showing one projection result while persisted sketches store a different result.

Alternative considered: keep editor projection in `modelingService.sketchSolver.projectExternalReferences` and commit projection in kernel-specific code. Rejected because it preserves the current split between unsupported editor projection and test-only commit projection.

### Project only contract-supported geometry

The first implementation should emit the existing projected geometry kinds: point, line segment, circle, and arc. Supported sources are:

- model vertex -> projected point
- linear model edge -> projected line segment
- circular/arc model edge -> projected circle or arc
- planar face coplanar with the sketch plane -> boundary line/circle/arc segments when available from topology
- existing sketch point/entity -> equivalent projected point/line/circle/arc when source geometry can be mapped into the active sketch plane

Unsupported curves, non-planar faces, missing topology, and ambiguous face boundaries should return explicit diagnostics without deleting the authored reference.

Alternative considered: add a generic polyline or spline projected geometry contract now. Rejected because it expands downstream region/profile/constraint handling beyond the requested behavior.

### Keep reference identity authoritative

Projection outputs must be keyed by authored `referenceId` and stable projected `geometryId` values scoped to the source reference. Derived regions, constraints, selections, and snap candidates should store or route through those projected identity values, not copied local sketch point/entity IDs.

Alternative considered: cache projected curve coordinates as authored sketch geometry for performance. Rejected because it breaks live update and invalidation semantics.

### Surface invalidation instead of remapping

When a source target cannot be resolved at a later revision, the authored reference remains in `SketchDefinition`, and projection returns an explicit status/diagnostic. Region/profile/constraint consumers must use that invalidation instead of silently remapping to a different topology target.

Alternative considered: best-effort remap by label or nearest geometry. Rejected because the current topology naming contract does not make that safe.

## Risks / Trade-offs

- [Topology lookup differs between mock and OCC adapters] -> Keep shared projection result tests at the contract/domain level and add adapter-specific tests for supported source kinds.
- [Projected face boundaries can create many segments] -> Emit only typed geometry segments the downstream contracts already support; report ambiguity when a face boundary cannot be represented safely.
- [Active editing projections can become stale after document revision changes] -> Include document/revision/request IDs in projection requests and discard stale editor responses using existing effect correlation.
- [Mixed local/projected profile loops can fail in OCC] -> Keep no-copy semantics and add tests for successful projected line/circle boundaries plus explicit invalidation when the live projection is unavailable.
- [Constraint solving may over-constrain local geometry against stale projected data] -> Feed projected references from the active revision into validation/solve and return diagnostics when reference geometry is missing.
