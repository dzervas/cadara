# Design: Onshape Surface Extrude Import

## Context

`planExtrudeFeature` bakes any `bodyType !== "SOLID"` extrude before it reads anything else. Every
other piece needed for a real surface import already exists: the extrude contract is a
`resultBodyType` discriminated union whose surface variant accepts `{ kind: "sketchEntity" }`
profile refs, and `buildSurfaceExtrudeFeatureShape` sweeps those wires into one sheet body through
the real OCC kernel. The gap is entirely in the importer: the surface profile parameter
(`surfaceEntities`) is never read, the prepared-action contract cannot express the surface variant,
and the provider hard-codes `resultBodyType: "solid"`.

## Goals / Non-Goals

**Goals:**
- Two local capture `Extrude 4` features import as surface extrude features and rebuild as sheet
  bodies through the real kernel.
- Open sketch-curve profile queries resolve to durable sketch entity refs of the same translated
  solved sketch the provider commits.
- Every surface form the contract or kernel cannot represent bakes with a specific reason code.

**Non-Goals:**
- Onshape surface revolve, sweep, loft, thicken-from-surface, or sheet boolean translation.
- Re-implementing or altering the kernel surface path.
- Onshape `flatOperationType` / sheet-metal semantics.

## Decisions

### D1: Surface profiles come from `surfaceEntities`, resolved without profile evidence
Onshape stores surface extrude profiles in `surfaceEntities`, and the capture emits no
`profileEvidence` for that parameter (the evidence manifest only covers `entities`). Two readable
query forms cover both captures and are decoded exactly:

1. `qCompressed(... entityType=EDGES, queryType=SKETCH_ENTITY, operationId=[<sketchFeatureId>,
   "wireOp"], sketchEntityId=<id> ...)` — one query names exactly one Onshape sketch entity. Decoded
   by the existing compressed-payload reader, extended with an EDGES/`SKETCH_ENTITY` entry point.
2. `query = qConstructionFilter(qBodyType(qCreatedBy(id + "<sketchFeatureId>", EntityType.EDGE),
   BodyType.WIRE), ConstructionObject.NO);` — names every non-construction wire edge of one sketch.

Each decoded Onshape entity id is mapped onto the *translated* solved sketch by entity label,
yielding the durable `SketchEntityId` the committed sketch will own. Form 2 additionally requires
that the sketch derives no closed region, because a sketch with region faces makes the
`BodyType.WIRE` filter's exact meaning unobservable from the capture; such a sketch bakes instead of
guessing. Any other query form, unavailable solved sketch, non-parametric sketch plan, or unmatched
entity label bakes with `extrude-surface-profile-unresolved`.

### D2: Reject disconnected chains at plan time
The kernel groups connected entities into one wire and rejects disconnected chains. Rather than
letting an unrepresentable plan fail at apply time (which rolls the whole import back), the planner
checks connectivity structurally over the translated definition's shared point ids and bakes with
`extrude-surface-profile-unresolved` when the selected entities do not form exactly one connected
chain.

### D3: The planned extrude discriminates its result body type
`PlannedExtrude` becomes a `resultBodyType` union mirroring the durable contract: the solid variant
keeps `operation` + `boolean`, the surface variant carries only profiles, start extent, extent, and
topology slots. This makes "a surface plan carries boolean state" unrepresentable inside the planner
as well as in the contract, and it keeps surface plans out of solid body lineage
(`bodyProducingFeatureIds`) without a side-band flag.

Surface plans bake when Onshape's surface operation is not `NEW` (`extrude-surface-operation-unsupported`)
or when a draft angle is authored (`extrude-surface-draft-unsupported`), because neither is
representable in the surface contract or the kernel path.

### D4: Deferred open sketch-curve profile refs reuse `ImportDeferredSketchEntityRef`
`OpenSketchCurveProfileRef` is structurally the durable `sketchEntity` ref, so the deferred form is
the existing `ImportDeferredSketchEntityRef` (`sketchId: SketchId | sketchIdOf`). The prepared
extrude parameters become a solid/surface union; the orchestrator materializes a deferred profile
`sketchId` exactly like the revolve axis and skips boolean-scope materialization for surface
variants. Import validation blesses `sketchIdOf` at the profile `sketchId` position and only reads
`booleanScope` for solid variants.

### D5: Translate Onshape's `symmetric` flag
`d3cd` `Extrude 4` authors `endBound=BLIND, depth=50 mm, symmetric=true`, and its captured rollback
sheet body spans z ∈ [-25 mm, +25 mm]. Cadara's `mode: "symmetric"` applies its end distance in both
directions, so the faithful translation halves the authored depth. Ignoring the flag would import a
sheet displaced by 25 mm from ground truth, so the flag is translated in the shared extent
translation for all extrudes rather than only for the surface path (a `THROUGH_ALL` + `symmetric`
extrude becomes a symmetric through-all extent).

## Risks / Trade-offs

- [Form 2 wire filtering is capture-observable only for region-free sketches] → require no derived
  closed region and bake otherwise, instead of assuming which edges `BodyType.WIRE` keeps.
- [`UP_TO_SURFACE` surface extrudes still need live topology] → the surface plan carries the same
  topology slot every solid up-to extrude uses, so it promotes only when the history probe resolves
  the face, and bakes with `needs-history-probe` otherwise.
- [Translating `symmetric` changes existing solid extrude plans] → it strictly increases fidelity and
  is pinned against captured ground truth; pinned tier baselines are re-measured.

## Migration Plan

None. No persisted data or contract version changes; the deferred extrude parameter union is
additive for solid payloads.

## Open Questions

None.
