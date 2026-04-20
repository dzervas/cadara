## Context

Sketch constraint authoring already has a shared registry, target selection flow, transient preview overlays, durable sketch constraint records, annotation descriptors, and solver-backed commit behavior. The current toolbar exposes coincident, parallel, perpendicular, tangent, equal, and dimension variants, while the sketch contract and solver already include several unexposed relationships such as `midpoint`, `midpointProjectedLine`, `pointOnCurve`, `concentric`, `concentricProjectedCurve`, and `fixPoint`.

The missing tools should be added through the existing constraint registry instead of introducing tool-specific UI state. The new toolbar IDs should follow the existing constraint naming pattern: `constraintConcentric`, `constraintMidpoint`, `constraintNormal`, `constraintPierce`, `constraintSymmetric`, and `constraintFix`.

## Goals / Non-Goals

**Goals:**

- Expose the six requested constraints as normal sketch-mode toolbar tools using the existing SVG icons.
- Route all six tools through `SketchConstraintDefinition` metadata, target resolution, previews, and commit contribution behavior.
- Reuse existing durable constraint shapes and solver residuals wherever they already represent the requested behavior.
- Add the smallest necessary contract/solver additions for relationships that cannot be represented durably by existing constraint records.
- Cover registry exposure, target selection, commit payloads, solver effects, annotations, and invalid target handling with `bun:test`.

**Non-Goals:**

- Redesign sketch authoring UI or the generic sketch tool presentation schema.
- Add a new solver package or external dependency.
- Replace existing coincident/parallel/perpendicular/tangent/equal behavior.
- Add broad CAD constraint variants beyond the six requested tools.

## Decisions

1. Keep constraint metadata and behavior in `src/domain/sketch-constraints/`.

   Each new tool will be a `SketchConstraintDefinition` entry with selection steps, target resolver, preview descriptor, and commit contribution. Toolbar definitions should consume or mirror those stable IDs the same way existing constraint tools do.

   Alternative considered: implement these as ad hoc editor commands. That would duplicate target-selection behavior and make tests depend on UI branches instead of domain contracts.

2. Map tools to existing durable constraints before adding new schema.

   Concentric maps to `concentric` and `concentricProjectedCurve`. Midpoint maps to `midpoint` and `midpointProjectedLine`. Pierce maps to `pointOnCurve` and `pointOnProjectedCurve`. Fix Geometry maps to one or more `fixPoint` constraints, plus a radius dimension for circles when needed to keep size fixed.

   Alternative considered: add one durable constraint kind per toolbar command. That would make the payload names match the UI, but it would duplicate solver relationships that already exist and increase persistence surface area.

3. Treat Normal and Symmetric as durable relationships if composition is insufficient.

   Normal should constrain a line to be normal to a circle or arc at a selected editable contact point. The contact point must remain on the curve and the line direction must remain perpendicular to the curve tangent at that point. Symmetric should constrain two editable points to remain mirrored about a selected local or projected line. If the existing solver cannot express either relationship without helper geometry that changes the authored sketch graph, add narrow `normal`, `normalProjectedCurve`, `symmetric`, and `symmetricProjectedLine` constraint records and residuals using existing solver math helpers.

   Alternative considered: always create hidden helper points or construction lines. That avoids schema additions but pollutes authored sketches with implementation geometry and makes delete/annotation behavior harder to reason about.

4. Keep annotations explicit for the new glyphs.

   `SketchAnnotationGlyphKind` and annotation icon resolution should include dedicated glyphs for concentric, midpoint, normal, pierce, symmetric, and fixed geometry. Existing constraints that were previously displayed as coincident glyphs can be mapped to the more specific glyphs as part of this change.

   Alternative considered: continue showing coincident glyphs for midpoint, pierce, and concentric. That would keep code smaller but would ignore the existing SVG assets and make dense sketches harder to inspect.

5. Fix Geometry constrains the selected object's current authored state.

   A selected point creates one `fixPoint` at its current position. A line creates fixed endpoints. A circle fixes the center point and current radius. An arc fixes center, start, and end points. A spline fixes all fit points. The tool should reject unsupported targets without committing a partial constraint set.

   Alternative considered: only support fixing points initially. That is simpler, but it does not satisfy the requested "geometry" behavior for common sketch entities.

## Risks / Trade-offs

- Normal and symmetric may need new persistent records -> Keep any additions narrow, include runtime schemas, validation, delete/reference handling, annotations, and solver tests in the same change.
- Fixing whole entities can create multiple constraints or dimensions from one click -> Label generated records consistently and ensure undo/delete behavior remains understandable through existing annotation selection.
- Projected-reference variants add target-order complexity -> Use resolver helpers that identify local editable operands and projected read-only operands independent of selection order.
- Toolbar and constraint registries can drift -> Add tests that compare toolbar exposure, icon mappings, and registered constraint definitions for the new IDs.

## Migration Plan

1. Extend icon/tool ID unions and toolbar/icon asset mappings for the six new constraints.
2. Add constraint registry definitions, target resolvers, previews, and commit contributions.
3. Add or extend durable constraint/runtime-schema/solver handling only for relationships not already expressible.
4. Update sketch-session deletion/reference/annotation helpers for any new or newly-specific constraint glyphs.
5. Add focused unit tests for authoring, solving, annotations, and invalid targets.
6. Verify with `bun run test`, `bun run lint`, and `bun run build`.

Rollback is a normal code revert because no external service or data migration is required. If new durable constraint kinds are added, rollback must also remove their runtime-schema fixtures and any persisted examples from tests.

## Open Questions

None.
