# Add Onshape Import Provider

## Why

The `add-onshape-capture-bundle` change produces self-contained `.onshape-capture.json` bundles holding an Onshape Part Studio's full parametric definition: ordered feature history, sketches with entities and constraints, variables, expressions, resolved reference signatures, and final-state ground truth. This change closes the loop: a file-based `ImportProvider` that translates a bundle into a native, editable cadara document — history, sketches, constraints, and variables intact — through the existing import pipeline.

Spike evidence shows the translation is largely mechanical: every feature kind and every sketch constraint observed in two real documents maps to existing cadara vocabulary (offset derivations arriving via `add-sketch-offset-derivation`). The genuinely hard part is topological reference resolution — Onshape deterministic IDs must be matched to cadara's kernel-owned topology by geometric signature, feature by feature, because the two kernels (Parasolid vs OCCT) mint incompatible identities. Fidelity will therefore vary per feature, and per the product principle that interop is identity, the import must report that honestly rather than fail wholesale or succeed silently wrong.

Two verified gaps in the generic import contract block a history-faithful importer and are fixed here generically rather than worked around: (1) the orchestrator applies prepared actions grouped by kind (variables, then features, then sketches), but real histories interleave kinds — a sketch on an extrude's face must be committed after that extrude; (2) providers have no way to interrogate intermediate rebuild topology, which reference matching requires.

## What Changes

- Add an **Onshape bundle import provider** (`src/domain/import/onshape/`) registered for `.onshape-capture.json`, implementing the full provider contract: non-mutating review, schema-driven review form, selections, and prepared actions.
- Add **tiered per-feature translation**: (1) native parametric feature, (2) baked-geometry fallback for unsupported options, unresolvable references, or custom FeatureScript features, (3) whole-studio baked geometry as last resort. The review form presents a per-feature fidelity report (tier, reason, diagnostics) before commit.
- Add **sketch translation**: entities (line/arc/circle/spline/point, construction flags), constraints, mirror/pattern/offset derivations, dimension expressions, and Onshape's solved positions as initial solver state so under-constrained sketches do not drift.
- Add **expression and variable translation**: `assignVariable` features become document variables; unit-bearing Onshape expressions (`4 mm`, `#nail * 2`) are translated into cadara's expression grammar, with structured diagnostics and literal-value fallback for untranslatable expressions.
- Add **reference resolution by geometric matching**: captured deterministic-ID signatures are matched against staged-rebuild topology per history step; ambiguous or failed matches degrade that feature to the baked tier with a diagnostic, never a guess.
- Add **ground-truth verification**: after translation planning, the review reports deviation between the staged cadara rebuild and the bundle's captured tessellation, following the mesh-import quality-report precedent.
- **Modify `import-provider-contract`**: prepared actions gain an explicit provider-specified interleaved order across action kinds (backward compatible — grouped order remains the default), and `ImportCapabilities` gains a sandboxed history-evaluation probe so providers can match references against intermediate topology without a parallel kernel path.

Out of scope: OAuth/proxy live import (transport arrives later; this provider only reads bundle files), assemblies, surface features, configurations, per-feature rollback snapshot consumption (bundle field reserved but unpopulated in capture v1), and re-capture automation (refresh follows the standard re-select-file flow with fingerprint comparison).

## Capabilities

### New Capabilities

- `onshape-import-provider`: Defines bundle acceptance, tiered translation and its degradation rules, sketch/constraint/derivation/expression mapping, reference resolution by geometric matching, fidelity reporting in review, ground-truth verification, and refresh binding.

### Modified Capabilities

- `import-provider-contract`: Prepared-action application honors an explicit provider-specified interleaved order; `ImportCapabilities` adds a sandboxed staged-history evaluation probe. Both are generic and benefit any future history-preserving importer.

## Impact

- Affected code: new `src/domain/import/onshape/` (bundle reader, feature/sketch/expression translators, signature matcher, fidelity planner, review form schema), `src/domain/import/builtin-provider-composition.ts` (registration), `src/contracts/import/actions.ts` (ordered actions), `src/contracts/import/capabilities.ts` (history probe), `src/domain/import/orchestrator.ts` (ordered application), infrastructure wiring for the probe capability onto the existing kernel worker path.
- Affected APIs/contracts: additive extensions to import actions and capabilities; consumes the `onshape-capture-bundle` envelope contract and the `offset` sketch derivation.
- Dependency impact: none new; depends on changes `add-onshape-capture-bundle` (bundle contract, fixtures) and `add-sketch-offset-derivation` (offset mapping; until it lands, OFFSET degrades to non-associative solved geometry with a diagnostic).
- Performance impact: reference matching requires staged rebuilds during review/prepare; bounded by history length and executed on the existing kernel worker. Large bundles parse once per session.
- Testing impact: logic-lane `bun:test` against the checked-in spike-capture fixtures — translation tables, expression grammar, signature matching (including ambiguity and unresolved paths), tier degradation, ordered action emission. UI lane only if the fidelity report needs presentation beyond the generic review form renderer. E2e deferred until the flow stabilizes.

## Assumptions and Open Questions

- **Assumption:** geometric-signature matching (type + defining data + centroid/bbox tolerance) disambiguates the vast majority of references on real models; ambiguity is expected on symmetric geometry. The chosen policy — degrade to baked with a diagnostic, never guess — trades fidelity for correctness. Stated alternative (interactive disambiguation UI in review) is deferred.
- **Assumption:** kernel divergence (Parasolid vs OCCT) will make some features fail rebuild even with correct inputs (fillet/shell edge cases). These surface through the existing feature-diagnostic pipeline and the affected feature degrades to baked; the ground-truth deviation report makes the consequence visible.
- **Open question:** whether the baked tier bakes the feature's *body delta* (requires per-feature rollback snapshots — capture v2) or the *final body* with downstream features suppressed (possible with capture v1). v1 of this provider implements the latter; the proposal keeps the former as the target once capture v2 lands.
- **Open question:** import of features below Onshape's rollback bar — proposed: import them suppressed, preserving authorship.
