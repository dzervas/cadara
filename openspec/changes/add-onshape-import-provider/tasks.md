## 1. Generic Contract Extensions

- [ ] 1.1 Add the ordered action sequence to `ImportPreparedActions` in `src/contracts/import/actions.ts` (refs across kind arrays, Typia validation, reject omissions/duplicates).
- [ ] 1.2 Implement ordered application in `src/domain/import/orchestrator.ts` on the single revision chain, preserving atomic failure; grouped fallback unchanged.
- [ ] 1.3 Add the history evaluation probe to `ImportCapabilities` (`src/contracts/import/capabilities.ts`): input sequence, per-step topology signatures, structured step diagnostics, explicit absence detection.
- [ ] 1.4 Implement the probe on the existing kernel worker path as a sandboxed session (no document/history/undo mutation).
- [ ] 1.5 Add `.spec.ts` coverage (logic lane, per `docs/testing.md`): ordered application incl. invalid sequences, grouped fallback regression for existing providers, probe contract against the mock kernel adapter.

## 2. Bundle Reading and Translation Tables

- [ ] 2.1 Implement the bundle reader: envelope validation reuse, narrow Typia validation of consumed Onshape payload shapes, unknown-shape diagnostics.
- [ ] 2.2 Implement the feature translator table (extrude, chamfer, shell, cPlane, transform, splitPart, booleanBodies, deleteBodies; boolean op and extent mapping; unsupported-option detection → reason codes).
- [ ] 2.3 Implement the sketch translator: entities, construction flags, constraint table with operand-reference parsing, MIRROR/LINEAR_PATTERN/OFFSET → derivations, solved-position seeding.
- [ ] 2.4 Implement the expression/variable translator: unit normalization, `#name` binding, literal fallback with diagnostics; `assignVariable` → document variables.
- [ ] 2.5 Add fixture-driven `.spec.ts` coverage for 2.1–2.4 using the spike capture fixtures.

## 3. Reference Resolution and Fidelity Planning

- [ ] 3.1 Implement the signature matcher: type + defining-data + tolerance ranking, unique/ambiguous/no-match outcomes, capture-side unresolved passthrough.
- [ ] 3.2 Implement the fidelity planner: history walk with probe integration, tier assignment and degradation reason codes, baked-tier v1 semantics (final-body bake + downstream suppression), probe-absent planning.
- [ ] 3.3 Implement ground-truth verification: staged rebuild vs captured tessellation deviation summary.
- [ ] 3.4 Add `.spec.ts` coverage: matcher outcomes (incl. symmetric-geometry ambiguity), tier degradation matrix, deviation reporting, probe-absent paths.

## 4. Provider Assembly

- [ ] 4.1 Implement review/selections/form-schema: studio selection, per-feature fidelity report with demotion controls, deviation summary (generic form field types only).
- [ ] 4.2 Implement prepare: ordered action emission in history order, suppression preservation, baked asset registration via `bakeGeometry`, local-file binding with capture provenance.
- [ ] 4.3 Register the provider in `builtin-provider-composition.ts` and its extension in the accepted file types.
- [ ] 4.4 Add `.spec.ts` coverage: end-to-end provider pipeline against fixtures via scoped registry composition (review → selections → prepare → ordered actions).

## 5. Verification

- [ ] 5.1 Manual smoke: import both spike-document bundles; confirm feature tree order, editable dimensions/variables, fidelity report accuracy, and rebuild.
- [ ] 5.2 Record per-tier counts and deviation results for both bundles in the change notes.
- [ ] 5.3 Follow-up task (not blocking): e2e flow — import fixture bundle, edit a dimension, rebuild.
- [ ] 5.4 Run `bun run test:all`.
