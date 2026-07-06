# Design: Onshape Import Provider

## Context

- Consumes the `onshape-capture-bundle` envelope (verbatim Onshape payloads + resolved reference signatures + ground truth) as an ordinary local file through `ResolvedImportSource`; no orchestrator source work.
- Spike mapping table (two documents, 51 features): all observed feature kinds map to `AuthoredFeatureKind` (`extrude`→extrude, `cPlane`→plane, `booleanBodies`→combine, `splitPart`→split, `deleteBodies`→deleteSolid, `assignVariable`→document variable, plus chamfer/shell/transform); all observed constraints map to `ConstraintDefinition` kinds; MIRROR/LINEAR_PATTERN/OFFSET map to sketch derivations (`offset` via `add-sketch-offset-derivation`).
- `ImportPreparedActions` already carries `createFeatures`/`commitSketches`/`addDocumentVariables` — exactly the needed action kinds — but the orchestrator applies them grouped by kind, and providers cannot observe intermediate rebuild topology. Both gaps are fixed in the generic contract (Decisions 4, 5).

## Decision 1: Tiered fidelity with per-feature honesty

Each history entry gets a translation plan with one tier:

1. **parametric** — native cadara feature/sketch/variable with all references resolved.
2. **baked** — geometry substitute registered through `ImportCapabilities.bakeGeometry` (STEP from the bundle), used when: unsupported feature option (e.g. extrude draft), custom FeatureScript feature, unresolvable/ambiguous reference, or staged rebuild failure from kernel divergence.
3. **geometryOnly** — entire studio as one baked body; last resort when history translation fails structurally.

The review form (generic renderer, `import-review-form-schema` field types) presents the plan before commit: per-feature tier, reason codes, and the ground-truth deviation summary — the mesh-import quality-report precedent extended to history fidelity. Selections let the user demote a parametric feature to baked (kernel-divergence escape hatch) or accept/abort; no selection can promote past what the planner verified.

Baked-tier v1 semantics (capture v1 has no per-feature rollback snapshots): the first baked feature bakes the final-state body and all downstream features import suppressed with diagnostics. When capture v2 populates `rollbackSnapshots`, the baked tier upgrades to per-feature body deltas and downstream features stay live; the plan/report shape already accommodates this.

## Decision 2: Sketch translation

- Entities and constraints translate table-driven (`BTCurveGeometry*` → entity kinds, `constraintType` → `ConstraintDefinition`), with entity-reference strings (`"abc.start"`) parsed into point/entity operands.
- Onshape's solved positions (bundle `sketches` section) seed initial geometry so cadara's solver starts at Onshape's solution — under-constrained sketches must not drift on import. A post-solve deviation check between cadara's solution and Onshape's solved state feeds the fidelity report.
- MIRROR/LINEAR_PATTERN/OFFSET constraint records become sketch derivations. If `add-sketch-offset-derivation` has not landed, OFFSET degrades: outputs import as plain entities at solved positions with a structured diagnostic (relationship lost, geometry correct).
- PROJECTED constraints become external-reference sketch geometry resolved through signature matching (Decision 5); unresolvable projections degrade to fixed construction geometry at solved positions with a diagnostic.

## Decision 3: Expression and unit translation

A small translator maps Onshape expression strings to cadara's expression grammar: unit literals normalized to document units, `#name` → document-variable references, arithmetic and supported functions mapped, unsupported constructs (configurations, unsupported functions) fall back to the captured evaluated literal plus a diagnostic marking the lost parametricity. Variables import first so later expressions can bind.

## Decision 4: Ordered prepared actions (generic contract change)

`ImportPreparedActions` gains an optional `orderedActions: ImportPreparedActionRef[]` sequencing entries across the existing kind arrays. The orchestrator applies `orderedActions` when present (single revision chain, atomic failure preserved), otherwise falls back to today's grouped order — fully backward compatible. This is required for any history importer: sketches on feature faces must commit after the feature exists.

## Decision 5: Reference resolution via staged history probe (generic contract change)

`ImportCapabilities` gains `evaluateHistoryProbe(input): Promise<HistoryProbeResult>` — executes a candidate action sequence in a sandboxed kernel session (existing kernel worker, no document mutation) and returns per-step topology signatures (face/edge/vertex geometry type, defining data, centroid, bbox) plus diagnostics.

The provider's matcher walks history in order; at each step it matches the bundle's captured deterministic-ID signatures against probe signatures using type + defining-data + tolerance ranking:

- unique match → resolved durable reference, continue;
- ambiguous (multiple candidates within tolerance) or no match → the consuming feature degrades to baked with a reason code; **never guess** (a wrong reference poisons everything downstream, violating the honest-interop principle);
- probe step fails to rebuild (kernel divergence) → same degradation path through existing feature diagnostics.

Sandboxing keeps this inside the non-mutating `review()` guarantee: planning runs probes, `prepare()` emits only the verified plan.

**Amendment (2026-07-06):** implementation surfaced that no kernel signature-extraction path exists yet (`BodyTopologySnapshotRecord` carries ids, not geometry). The probe *contract* lands in this change; the *implementation* moves to `add-kernel-topology-signatures`, built over the native exact-B-rep payload path (`OccNativeExactBrepTableLayout.surfaces` already exists for `.cadara` export). This change ships probe-absent planning as the implemented path: default-plane signatures resolve against canonical planes and sketch-region references match in 2D against cadara's region extraction (both probe-free); face sketches, edge selections, and body scopes plan as `baked` with a capability reason code; ground-truth verification reports as explicitly unavailable. The matcher and deviation comparison are implemented and tested against a mock probe so the follow-up change activates them without provider modifications. Fixture bundles are assembled offline by running the capture pipeline against the CLI's checked-in fixture transcript.

## Decision 6: Provider structure and registration

`src/domain/import/onshape/` splits into pure modules — bundle reader (narrow Typia validation of the payloads the translator actually consumes, unknown shapes → diagnostics, honoring the archival contract's `unknown` boundary), feature translator, sketch translator, expression translator, signature matcher, fidelity planner, review-form schema builder — composed by a thin provider object registered in `builtin-provider-composition.ts`. Refresh uses the standard local-file binding: re-select bundle, fingerprint comparison, full pipeline re-run.

## Decision 7: Testing (per docs/testing.md)

Lane: **logic** for everything load-bearing: translation tables (fixture-driven from the spike captures), expression grammar cases, solved-state seeding and deviation checks, matcher ranking/ambiguity/unresolved paths, tier degradation rules, ordered-action emission, orchestrator ordered application, and probe capability contract (mocked kernel seam like existing `mock-kernel-adapter`). UI lane only if the fidelity report requires bespoke presentation beyond the generic review-form renderer. E2e: one flow (import fixture bundle → history visible → edit a dimension → rebuild) deferred until after the provider stabilizes, tracked as a task, not a blocker.

## Risks

- Signature matching precision/recall on symmetric or dense geometry → tolerance ranking with margins; degrade-not-guess bounds the blast radius to one feature (plus downstream in baked v1).
- Probe cost on long histories (O(features) staged rebuilds) → probes batch per history walk, run on the worker, and reuse the session across steps; review shows progress.
- OCCT rebuild divergence on fillet/shell-heavy models → surfaced per feature via the existing diagnostics pipeline and the deviation report; user demotion to baked is the escape hatch.
- Contract creep: ordered actions + probe are additive and generic, but review must confirm no existing provider behavior changes (grouped default preserved, probe optional).
