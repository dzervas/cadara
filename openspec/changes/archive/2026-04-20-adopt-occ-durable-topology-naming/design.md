## Context

The OCC adapter currently gives every replacement body a new topology token and re-enumerates faces, edges, and vertices by traversal order. Boolean execution enables OCC history with `SetToFillHistory(true)`, but the adapter only converts that history into invalidation records. It does not bind previous durable topology ids to current OCC subshapes.

This makes the system conservative but unstable: a face or edge reference can become missing after a boolean even when OCC still contains the exact same subshape or can identify one unique modified successor. The existing ignored limitation tests describe the target behavior, and they currently fail because old subshape ids are absent from the post-replacement reference map.

OpenCascade.js already exposes the heavier naming APIs needed for a more faithful approach: `TDocStd_Document`, `TDF_Label`, `TNaming_Builder`, `TNaming_Selector`, `TNaming_Tool`, `BRepAlgoAPI_BuilderAlgo.History()`, `BRepTools_History`, and `ShapeUpgrade_UnifySameDomain.History_*`.

## Goals / Non-Goals

**Goals:**

- Use OCC's OCAF/TNaming APIs as the internal source of truth for OCC topology naming.
- Preserve existing public durable reference shapes for bodies, faces, edges, and vertices where a unique successor exists.
- Keep unchanged subshapes live across booleans, same-domain simplification, and feature replacement.
- Report deleted or ambiguous topology references explicitly instead of guessing.
- Promote the existing topological naming limitation tests into the default suite and add more regression tests before the refactor.
- Keep OCAF labels, selector details, and OCC object handles private to the OCC adapter.

**Non-Goals:**

- Persist raw OCAF documents as the application document format.
- Expose OCAF labels or TNaming objects through public frontend contracts.
- Guarantee perfect topological naming for inherently ambiguous modeling edits.
- Replace the authored feature history, operation history, or repository model.
- Solve imported third-party model naming unless the shape participates in the OCC authoring rebuild path.

## Decisions

### Use OCAF/TNaming As The Naming Backbone

The adapter will maintain an internal naming document for each OCC authoring rebuild. Bodies and their subshapes receive stable internal labels. Feature execution records primitive, generated, modified, deleted, and selected shapes through `TNaming_Builder` and `TNaming_Selector`.

Alternative considered: compose only `Modified`/`Generated` maps from builders and unifiers. That is a smaller patch, but it would leave the app with a home-grown naming system just as the requirements expand beyond simple booleans. The user explicitly wants to use OCC's proper naming stack, so the design should make OCAF/TNaming the long-term internal primitive.

### Keep Public Durable IDs Stable, Not OCAF Labels

Durable public refs such as `face:<bodyId>:<faceId>` stay unchanged. The OCC naming layer maps each public topology id to an internal naming label and current subshape. When a feature rebuild produces exactly one valid successor for an old subshape, the old public id is rebound to that successor. New unclaimed subshapes get fresh ids.

Alternative considered: expose label entries or OCAF paths as public topology ids. That would leak implementation details, make future kernel replacement harder, and break the existing contract boundary.

### Treat Ambiguity As Invalid, Not Automatically Remapped

If TNaming/OCC history yields zero successors, the ref is invalidated as deleted or missing. If it yields more than one plausible successor, the ref is invalidated as ambiguous. The adapter must not silently choose by traversal order, area, centroid, or first result when OCC cannot produce a unique answer.

Geometric signatures can be used only as diagnostics or a fallback inside a clearly bounded spike; they must not override TNaming ambiguity by default.

### Capture Refinement In The Naming Pipeline

Boolean results currently pass through `SimplifyResult(...)` and `ShapeUpgrade_UnifySameDomain`. The refactor will either record these steps into the OCAF/TNaming document or feed their `BRepTools_History` output into the naming update before final topology ids are assigned. The final public topology map must refer to the final shape actually stored on the body, not the pre-refined builder result.

### Promote Tests Before Refactoring Behavior

The existing ignored limitation tests should move into a normal `src` test file or equivalent default Bun test path as expected-failing coverage during the implementation branch. Additional tests should cover deleted, ambiguous, and rebuild-stability cases so the refactor cannot pass by only fixing the known boss/rib fixture.

## Risks / Trade-offs

- OCAF/TNaming API complexity -> mitigate with a small OCC naming service module and tests around label creation, selector solving, and successor resolution.
- WebAssembly object lifetime leaks -> explicitly delete temporary OCC handles where local code owns them, and keep naming document ownership scoped to an authoring rebuild.
- TNaming may still return ambiguous or surprising results -> treat ambiguity as a first-class invalidation state and write regression tests for the expected invalid cases.
- Same-domain refinement can disconnect history from final topology -> include refinement history in the naming pipeline and test pre-simplification edge survival.
- Public diagnostics may change from generic missing references to more precise deleted or ambiguous reasons -> keep this additive and machine-readable.
- Rebuild performance may degrade from naming every subshape -> start with body, face, edge, and vertex labels only, then profile complex feature chains before adding deeper naming.

## Migration Plan

1. Move the ignored topology naming tests into the default test suite and add the new failing scenarios.
2. Add an internal OCC naming service behind `occ/topology` and `occ/features` without changing public contract types.
3. Seed initial/new body topology labels and bind public topology ids to TNaming labels.
4. Record feature evolution for booleans, fillet/chamfer, shell/thicken, transform, split/delete, and refinement steps.
5. Replace token-only replacement enumeration with naming-aware topology reconciliation.
6. Keep explicit invalidation records for deleted, missing, and ambiguous refs.
7. Remove the ignored-test duplicate once equivalent promoted coverage is passing.

Rollback is straightforward before archiving: revert the naming-aware reconciliation and restore tokenized replacement enumeration. The public contract remains compatible.

## Open Questions

- Should ambiguous topology references use a new `occ-topology-ambiguous` reason string, or reuse `occ-topology-modified` with richer diagnostic detail?
- Should vertex naming be implemented in the first pass, or can the initial refactor focus on faces and edges because current feature flows mostly consume those?
- Should the OCC naming document be kept only during rebuild, or cached between rebuilds for performance?
