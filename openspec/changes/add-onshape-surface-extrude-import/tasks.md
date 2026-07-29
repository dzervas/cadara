## 1. Extend the import prepared-action contract

- [x] 1.1 Make `ImportDeferredExtrudeFeatureParameters` a `resultBodyType` union whose surface variant omits `operation`/`booleanScope` and accepts deferred open sketch-curve profile refs.
- [x] 1.2 Bless `sketchIdOf` at the extrude profile `sketchId` position and validate the deferred profile reference like the revolve axis; read `booleanScope` only for solid variants.
- [x] 1.3 Materialize deferred open sketch-curve profile sketch ids in the orchestrator and skip boolean-scope materialization for surface variants.
- [x] 1.4 Add contract validation coverage for accepted surface payloads and rejected non-`sketchIdOf` profile deferrals.

## 2. Resolve Onshape open sketch-curve profiles

- [x] 2.1 Add an exact reader for compressed `SKETCH_ENTITY` edge queries beside the existing vertex reader.
- [x] 2.2 Resolve `surfaceEntities` queries to durable translated sketch entity ids, supporting the compressed per-entity form and the readable whole-sketch wire `qCreatedBy` form.
- [x] 2.3 Reject region-bearing sketches for the whole-sketch wire form, unmatched entity labels, and entity sets that are not one connected chain, with explicit diagnostics.
- [x] 2.4 Add profile-resolver specs for both readable forms and each rejection path.

## 3. Plan and prepare surface extrudes

- [x] 3.1 Make `PlannedExtrude` a `resultBodyType` union and plan `SURFACE` extrudes with profiles, start extent, and extent only.
- [x] 3.2 Bake surface extrudes with a non-`NEW` surface operation, an authored draft angle, or unresolved profiles, using specific reason codes.
- [x] 3.3 Translate Onshape's `symmetric` flag into a symmetric extent with a halved blind depth.
- [x] 3.4 Keep surface extrudes out of solid body lineage in the extrude feature translator.
- [x] 3.5 Emit `resultBodyType: "surface"` extrude requests from the provider with deferred open sketch-curve profile refs and no boolean fields.
- [x] 3.6 Reword the solid-path kernel rejection of open sketch-curve profiles.

## 4. Prove it against the captures

- [x] 4.1 Rewrite the Wave X surface-extrude fixture so both studios mirror the real capture profile query forms and end bounds.
- [x] 4.2 Update planner/provider/fidelity specs so the two `Extrude 4` features are feature-tier surface extrudes instead of baked.
- [x] 4.3 Prove a prepared surface extrude rebuilds to a `bodyKind: "sheet"` body through the real kernel apply path.
- [x] 4.4 Re-measure pinned real-bundle tier baselines and run `bun run test:logic`, `bun run test:static`, and `bun x tsc -b tsconfig.app.json --noEmit`.
