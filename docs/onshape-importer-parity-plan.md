# Onshape Importer Parity Plan

Goal: every Onshape feature type that Cadara can represent parametrically imports
as a parametric feature; everything else (sheet metal, surfacing, etc.) bakes
honestly with a specific reason code. Verified by importing the two real capture
bundles (`*.onshape-capture.json` in repo root) and interactively editing the
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
- [ ] 1.3 **Topology reference resolver (design, then implement).** Resolve
      Onshape face/edge/body queries mid-history using rollback snapshots + the
      signature matcher into durable Cadara refs. Kills `needs-history-probe`
      as a class. Design doc first (`docs/architecture/`), then implementation
      with spec coverage. Consumers: fillet/chamfer, shell, booleans, mirror,
      transform, split, cPlane-on-face, hole.

## Phase 2 — Feature translators (parallel waves)

Each item: translator module + `.spec.ts` + apply-pipeline coverage + specific
degradation reason codes for unsupported parameter combos. Registered via the
Phase-1 registry.

Wave A (needs 1.1 + 1.2):
- [ ] A1 `revolve`
- [ ] A2 `thicken`
- [ ] A3 `sweep`
- [ ] A4 `loft`

Wave B (needs 1.1 + 1.3):
- [ ] B1 `fillet` + `chamfer`
- [ ] B2 `shell`
- [ ] B3 `booleanBodies` + `deleteBodies` → combine / deleteSolid
- [ ] B4 `mirror` + `transform`
- [ ] B5 `splitPart` + `split`
- [ ] B6 `hole`

Wave C (cheap long tail, needs 1.1 only):
- [ ] C1 Honest-bake table: explicit mappings for out-of-scope feature types
      (sheet metal family, surfaces, rib, ruledSurface, wrap, projectCurves,
      trimCurve, tag, sphere, …) with per-family reason codes replacing the
      `custom-feature` catch-all; review-form copy for each.

## Phase 3 — Integration & verification (sequential)

- [ ] 3.1 Review-form diagnostics: per-feature carried/dropped summaries for
      new tiers; tier-count assertions updated in provider/planner specs.
- [ ] 3.2 Import both capture bundles; record tier counts before/after in this
      file. Target: extrude/revolve/chamfer/sketch/plane/transform/boolean
      features in both bundles fully parametric.
- [ ] 3.3 **Interactive Playwright verification** (manual-check replacement):
      import each bundle in the running app, then (a) drag constrained sketch
      geometry and confirm solver keeps shape, (b) edit a variable-driven
      dimension and confirm downstream features rebuild, (c) edit translated
      feature parameters (extrude depth, revolve angle, fillet radius) and
      confirm rebuild, (d) reorder/suppress a mid-history feature where legal.
- [ ] 3.4 `bun run test:all` + e2e suite green.

## Verification notes / tier counts

(filled in by agents as work lands)
