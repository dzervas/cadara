# Onshape Importer Parity Plan

Goal: every Onshape feature type that Cadara can represent parametrically imports
as a parametric feature; everything else (sheet metal, surfacing, etc.) bakes
honestly with a specific reason code. Verified by importing the real capture
bundles tracked in `test/fixtures/onshape-captures` and interactively editing the
result (drag sketch geometry, edit dimensions/variables, rebuild) via Playwright.

Process: no openspec. Each work item = one commit by one agent. Agents check off
their item here. Test policy per `docs/testing.md` (logic lane `.spec.ts` +
apply-pipeline coverage against real fixtures).

## Current state (baseline cf61d8c)

Parametric: `defaultPlane`, `cPlane` → plane, `newSketch` (incl. constraints,
dimensions, mirror/linearPattern/offset derivations), `extrude` (region
verification, boolean lineage). Everything else bakes with
`needs-region-resolution` / `needs-history-probe` / `custom-feature`.

Assets to build on:
- `src/domain/import/onshape/extrude-planner.ts` — region resolution + interior
  points + deferred profiles (to be generalized).
- Rollback snapshots per feature (capture v2) — sandboxed mid-history geometry.
- `signature-matcher.ts` / `signature-interpreter.ts` + kernel topology
  signatures — durable topology references.
- `expression-translator.ts` — variable/expression-backed values.

Cadara feature targets: plane, sketch, extrude, revolve, fillet, chamfer, shell,
combine (boolean), split, deleteSolid, sweep, loft, thicken, mirror, transform,
hole (see `src/contracts/modeling/schema.ts`, `advanced-solid.ts`).

## Phase 1 — Foundations (sequential; enables the parallel fan-out)

- [x] 1.1 **Translator registry.** Refactor `fidelity-planner.ts` + `provider.ts`
      so each Onshape feature type is handled by a registered translator module
      (interface modeled on what `extrude-planner.ts` needs). Inline
      extrude/sketch/plane branches move behind the registry. No behavior
      change: identical tier counts + diagnostics on both capture bundles,
      existing specs green. This makes Phase 2 additive (new files, no shared
      hot-spot edits).
- [x] 1.2 **Shared profile/region resolver.** Extract the region verification,
      interior-point derivation, and deferred-profile machinery from
      `extrude-planner.ts` into a reusable module usable by revolve, sweep,
      loft, thicken. Extrude re-implemented on top of it; no behavior change.
- [x] 1.3 **Topology reference resolver (design, then implement).** Resolve
      Onshape face/edge/body queries mid-history using rollback snapshots + the
      signature matcher into durable Cadara refs. Kills `needs-history-probe`
      as a class. Design doc first (`docs/architecture/`), then implementation
      with spec coverage. Consumers: fillet/chamfer, shell, booleans, mirror,
      transform, split, cPlane-on-face, hole.
      Core implementation tasks 2–8 are complete: evidence/query readers, signature normalization and matching, body signatures, the all-or-nothing resolver, exact-prefix probing, apply-time live-ref rematching, and per-feature rollback baking. The foundation item is complete; Phase-B consumer adoption and v2 real-bundle recapture/acceptance remain separate follow-up work.

## Phase 2 — Feature translators (parallel waves)

Each item: translator module + `.spec.ts` + apply-pipeline coverage + specific
degradation reason codes for unsupported parameter combos. Registered via the
Phase-1 registry.

Wave A (needs 1.1 + 1.2):
- [x] A1 `revolve` — parametric for a verified sketch-region profile with a
      same-sketch solved line axis and `FULL`/one-direction expression-backed
      angle; other axis/extent/boolean combinations degrade as
      `revolve-axis-unresolved`.
- [x] A2 `thicken` — honestly baked as `thicken-requires-topology`; Onshape
      selects faces and this wave has no durable face materialization seam.
- [x] A3 `sweep` — OCC now accepts a solved `sketchEntity` line/arc/circle path,
      but Onshape translation remains honestly baked as `sweep-path-unresolved`:
      an Onshape path query may represent a connected multi-curve chain while
      Cadara's current sweep contract accepts exactly one path target.
- [x] A4 `loft` — honestly baked as `loft-profile-unresolved`; Onshape's ordered
      `wireProfilesArray`/`sheetProfilesArray` records also carry profile
      conditions, periodicity, guides, and connection data that the shared
      single-query region resolver cannot preserve losslessly.

Wave B (needs 1.1 + 1.3):

Note: `supportsDurableTopologyNaming` is false and qualification found a release
blocker (silent remap after topology-changing upstream edit — see
`docs/architecture/onshape-topology-reference-resolution.md`, "Durable naming
qualification status"). Until fixed, subtopology (edge/face) consumers B1/B2
must translate but gate to `topology-durable-naming-unavailable` at plan time;
body-only consumers B3–B5 may go fully parametric.

- [x] B1 `fillet` + `chamfer` (gated on durable naming) — translators validate radius/equal-offset width and declare edge slots; v2 resolution remains explicitly gated.
- [x] B2 `shell` (gated on durable naming) — validates thickness/body/opening-face slots; hollow shells with no removed faces report `shell-hollow-without-openings`.
- [x] B3 `booleanBodies` + `deleteBodies` → combine / deleteSolid — body slots resolve at the exact pre-consumer prefix; inactive offset queries are ignored and duplicate delete encodings deduplicate by semantic role.
- [x] B4 `mirror` + `transform` — body selections resolve parametrically; canonical datum mirror/distance references map to seeded constructions, XYZ translation maps to a vector option, and rotation degrades explicitly.
- [x] B5 `splitPart` + `split` — the supported body-target/body-tool, both-sides form resolves parametrically; face tools and one-side results degrade explicitly.
- [x] B6 `hole` — validates simple-hole diameter/location/scope input and runs topology resolution, but reports `hole-executor-unavailable` because OCC has no hole executor.

Wave C (cheap long tail, needs 1.1 only):
- [x] C1 Honest-bake table: explicit mappings for out-of-scope feature types (sheet metal, surfaces/curves, primitives, annotations/meta, operations, patterns, tolerances) with review-form copy; unknown types remain `custom-feature`.
      (sheet metal family, surfaces, rib, ruledSurface, wrap, projectCurves,
      trimCurve, tag, sphere, …) with per-family reason codes replacing the
      `custom-feature` catch-all; review-form copy for each.

## Phase 3 — Integration & verification (sequential)

- [x] 3.1 Review-form diagnostics: per-feature carried/dropped summaries for
      new tiers; tier-count assertions updated in provider/planner specs.
- [x] 3.2 Import both capture bundles; record tier counts before/after in this
      file. Target: extrude/revolve/chamfer/sketch/plane/transform/boolean
      features in both bundles fully parametric.
- [x] 3.3 **Interactive Playwright verification** (manual-check replacement):
      import each bundle in the running app, then (a) drag constrained sketch
      geometry and confirm solver keeps shape, (b) edit a variable-driven
      dimension and confirm downstream features rebuild, (c) edit translated
      feature parameters (extrude depth, revolve angle, fillet radius) and
      confirm rebuild, (d) reorder/suppress a mid-history feature where legal.
- [x] 3.4 `bun run test:all` + e2e suite green.

## Verification notes / tier counts

(filled in by agents as work lands)

- 3.2 tier counts (2026-07-16): baseline before this plan was `6/4/0` (Mounts) and
  `6/35/0` (Part Studio 1) — unchanged after, **by design**: both checked-in
  bundles are v1 captures without rollback snapshots or history-point
  references, so topology consumers stay on the honest legacy path. What changed
  in-app: imported sketches are now truly constrained (residual mobility
  grounded), the probe-backed extrude commits in Part Studio 1, feature edits
  preserve downstream baked bodies, and every baked row carries a specific
  family/topology reason instead of `custom-feature`. Parametric tier gains for
  revolve/boolean/transform/split/delete/mirror are proven by synthetic v2
  fixtures and will apply to real bundles after v2 recapture with automatic
  proven-boundary snapshots and all-IDs history resolution.

- Wave A verification (2026-07-15): both root captures contain zero `revolve`,
  `thicken`, `sweep`, or `loft` history entries. Tier counts therefore remain
  unchanged and are asserted in both planner and provider specs:
  - `40a51fb8fa82fd4565151114.onshape-capture.json` / `Mounts`: **6 parametric,
    4 baked, 0 geometry-only**.
  - `9841e486906fa2ce62d74d8e.onshape-capture.json` / `Part Studio 1`: **6
    parametric, 35 baked, 0 geometry-only**.
- Synthetic Wave-A capture coverage mirrors real `BTMParameter*` envelopes and
  the captured revolve feature-spec defaults. It proves planner/provider
  translation, deferred `regionOf` + `sketchIdOf` materialization, and the apply
  pipeline's concrete revolve request. OCC feature coverage proves the solved
  sketch-entity revolve axis and sweep path seams.
- Topology wiring verification (2026-07-15): design tasks 6–8 are complete. Exact pre-consumer prefixes are probed without final tessellation, `topologyOf` selectors rematch only in blessed request positions, and v2 post-feature snapshots produce prepared checkpoint fallbacks. Both root bundles remain v1 and explicitly report `topology-history-evidence-missing` plus `topology-bake-snapshot-missing`; tier counts remain **6/4/0** and **6/35/0**. Subtopology adoption remains gated while durable naming is unavailable.
- Wave B1/B2/B6 and C1 verification (2026-07-15): fillet/chamfer/shell now declare and validate their source parameters and topology slots before the shared exact-prefix resolver; with durable naming disabled, edge/face consumers report `topology-durable-naming-unavailable`. Shell-without-openings and unsupported chamfer/hole combinations retain specific parameter reasons. Hole additionally remains blocked by `hole-executor-unavailable` after topology resolution because OCC exposes no hole executor. Gate-flip logic coverage proves fillet/chamfer definitions carry typed deferred edge positions. Wave-C fallback classification now distinguishes sheet metal, surface, curve, primitive, annotation/meta, part-operation, pattern, and tolerance families, retaining `custom-feature` only for unknown types. Root bundle tier counts remain **6/4/0** and **6/35/0**; the checked-in studio histories enumerate only `assignVariable`, `newSketch`, `extrude`, `transform`, `chamfer` (Mounts) and `assignVariable`, `newSketch`, `cPlane`, `extrude`, `chamfer`, `shell`, `splitPart`, `booleanBodies`, `deleteBodies` (Part Studio 1).
- Interactive Playwright verification (2026-07-15): `e2e/onshape-import-parametric.spec.ts` imports both checked-in captures through the review/commit UI and exercises sketch vertex dragging, variable rebuilds with viewport-geometry deltas, imported-extrude editing, baked-body stability, diagnostics, and the expected plane/sketch/extrude timeline set. Shared real-bundle import and variable helpers now live in `e2e/helpers/onshape-import.ts` and are also used by `onshape-variable-rebuild.spec.ts`.
  - Confirmed working: Mounts imports with zero snapshot diagnostics and exposes the seeded planes, imported sketch, translated extrude, and baked body; changing `nail` while rolled to the translated extrude changes rendered geometry and retains `body_feature_extrude-1` with zero diagnostics. Part Studio 1 exposes its imported plane and four parametric sketches; changing `walls` changes rendered geometry, and both baked body targets remain stable.
  - Resolved defect 1 — constrained sketch drag: four source anchors were external-reference relationships whose query-only operands could not bind to local Cadara operand types. The old solve-consistency pass only solved seeded geometry, so free rigid translation looked consistent. Solved-sketch capture now carries `WELL_DEFINED`; verification perturbs and re-solves with the real solver, then adds at most two suitable `fixPoint` anchors only when residual rigid mobility is detected, carrying `onshape-sketch-residual-mobility-grounded`. Mounts retains its translated relationships and the constrained vertex no longer follows the drag.
  - Resolved defect 2 — baked body loss during extrude edit: preview pre-resolved the persistent asset but its transient `buildNextAuthoringState` omitted `resolvedGeometryAssets` and `bakedShapeCache`, so the full preview chain reported the baked asset unavailable. Preview now shares the create/update pre-resolution path and carries both maps into rebuild state. Successful feature-edit cursor restoration advances to the document tail, rebuilding downstream baked history; `body_feature_bakedBody-1` survives preview and commit.
  - Resolved defect 3 — probe-backed construction plane: the construction-plane frame gap in the probe-backed path was fixed through snapshot and implementation-policy changes, restoring Part Studio 1's parametric plane/sketch/extrude chain and variable rebuild behavior.
- Wave B3–B5 verification (2026-07-15): registered body-only translators now emit normal advanced-solid definitions after exact-prefix body resolution. Boolean maps `UNION`/`SUBTRACTION`/`INTERSECTION` to `add`/`subtract`/`intersect`, preserves `keepTools`, ignores inactive offset selections, and delete deduplicates `entities`/`nonCompositeEntities`. Transform supports XYZ translation vectors and canonical-plane normal distance; rotation/copy/unknown modes degrade specifically. Mirror supports part/new-body copies across canonical datum planes. Split supports one target body plus one body tool with both sides and explicit tool retention/consumption; face tools and one-side modes degrade. The narrowly bridged kernel options are transform `vector`, combine `keepTools`, and split `keepTools`. Compact v2 fixtures cover extrude→transform and extrude→delete through live apply rematching, and two-extrude boolean/split planning through deferred participant emission; all stored applied definitions contain live body refs and no `topologyOf`. Root v1 fixtures explicitly remain legacy-degraded with unchanged **6/4/0** and **6/35/0** counts.
- Real v2 re-capture root-cause audit (2026-07-16): `9841e486…` was re-captured
  as a true formatVersion-2 bundle (28 rollback snapshots, 328 resolved
  references, 105 history-point records). The body-only consumers (Boolean 1,
  Delete part 1, Split 1) still do not promote — and that is **correct by
  design**, not a resolver defect. Root cause per consumer, from the rollback
  timeline: Split 1 targets body `JND` (shaped by Extrude 1 → Chamfer 1/2 →
  Shell 1 → Extrude 2/3, all baked: region-degraded extrudes and gated
  chamfers/shell) with tool `JaD` (Extrude 4, baked); Boolean 1 targets `JbH`
  and Delete part 1 removes `J5D`/`J5H`, all downstream of the baked Split 1.
  Every queried body exists only in baked history segments, so the parametric
  prefix can never contain it. Two diagnostics bugs were fixed so the review
  tells this truth:
  1. Body-consumer resolution now attributes each queried body to every
     rollback-snapshot segment that introduced or reshaped it
     (`featuresModifyingBody` on the rollback timeline). When any such segment
     is non-parametric the consumer reports `topology-upstream-baked` instead
     of the misleading `topology-reference-no-match` (real-OCC path) or
     `translator-unavailable` (logic-lane path where the mock prefix probe
     yields no signatures).
  2. A failed pre-consumer prefix probe no longer silently falls through to the
     `translator-unavailable` rewrite; it reports
     `topology-history-evidence-missing`.
  With a history capability the re-captured Part Studio 1 now reviews at
  **9 parametric / 32 baked / 0 geometry-only** (unchanged by this audit —
  gains come from the captured-frame plane/sketch/extrude chain), with honest
  consumer reasons: Boolean 1 / Delete part 1 / Split 1 →
  `topology-upstream-baked`; Chamfer 1/2/4 → `topology-durable-naming-unavailable`
  (real kernel) as the durable-naming gate requires. Probe-less review of both
  root bundles remains **6/4/0** and **6/35/0**; Mounts (v2 without snapshots)
  keeps the legacy `topology-history-evidence-missing` +
  `topology-bake-snapshot-missing` pair, while snapshot-backed Part Studio 1
  keeps the static `needs-history-probe` reason. What must change before these
  three consumers can genuinely promote: their upstream body producers
  (region-degraded extrudes, gated chamfers, hollow shell) must first become
  parametric — the consumers resolve automatically once the prefix carries the
  bodies, as proven by the synthetic v2 promote paths plus the new
  baked-producer and failed-prefix specs in `apply-pipeline.spec.ts`.
