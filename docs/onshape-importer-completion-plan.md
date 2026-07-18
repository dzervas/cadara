# Onshape Importer Completion Plan

Successor to `docs/onshape-importer-parity-plan.md` (all items there are done).
Goal: every Onshape feature that maps onto a feature kind **cadara already has**
imports parametrically; a single unsupported feature no longer bakes the whole
downstream history; everything genuinely out of scope bakes honestly with a
specific reason code.

Scope decisions (2026-07-18, user-confirmed):

- **Existing cadara capabilities only.** No new feature kinds (patterns, draft,
  rib, primitives, curves stay honest-bake). No hole executor, no transform
  rotation option. If a translator gap can be closed purely by exploiting
  contract surface that already executes in OCC, it is in scope.
- **Durable topology naming: spike first.** Phase K decides whether a pre-8.0
  fix is feasible; subtopology consumers (fillet/chamfer/shell/thicken/
  sketch-on-face) stay gated behind `topology-durable-naming-unavailable`
  until the spike says otherwise.
- **Bake-cascade containment is in scope** (per-feature rollback checkpoints
  replacing whole-studio first-bake poisoning).
- **Onshape API use is allowed** (credentials in `.envrc`; never print them).
  Agents may recapture the two known documents and author/capture new test
  documents.

Process: same as the parity plan — no openspec. One work item = one commit by
one agent; agents check items off here and append verification notes at the
bottom. Test policy per `docs/testing.md` (logic lane `.spec.ts` +
apply-pipeline coverage; real-capture baselines skip when the gitignored
bundle is absent). After each item: `bun run test:all` relevant slices green.

## Baseline (2026-07-18, commit 06270237)

- `40a51fb8fa82fd4565151114` (Mounts, v2, 8 rollback snapshots): plans
  **6 parametric / 4 baked / 0 geometryOnly**. Baked: Sketch 2
  (`needs-history-probe`, on a face), Extrude 2 (`needs-region-resolution` +
  `downstream-of-baked`), Transform 1 (`transform-rotation-unsupported` —
  genuinely out of scope), Chamfer 1 (`needs-history-probe`, gated).
- `9841e486906fa2ce62d74d8e` (Part Studio 1): bundle **missing from repo root**
  → `fidelity-planner.spec.ts` real-bundle test currently fails on ENOENT.
  Last recorded plan: 9/32/0 as v2.
- `OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming === false`; release
  blocker documented in
  `docs/architecture/onshape-topology-reference-resolution.md`
  ("Durable naming qualification status": upstream topology-changing sketch
  edit reports a deleted edge as live).
- Known gap analysis (translator-by-translator) lives in the section
  "Reference: current translator behavior" below; the full Onshape-vs-cadara
  feature gap inventory (incl. out-of-scope items) is
  `docs/onshape-feature-gaps.md`.

## Phase 0 — Captures & harness (parallel-safe, do first)

- [ ] 0.1 **Restore the second capture + make real-bundle specs skip cleanly.**
      Recapture `9841e486906fa2ce62d74d8e` with `--rollback-snapshots` into the
      repo root (stays gitignored). Change every spec that loads root
      `*.onshape-capture.json` (fidelity-planner, provider, apply-pipeline,
      e2e helpers) to `test.skipIf(!existsSync(...))` instead of failing, so CI
      and fresh clones stay green while local runs still pin tier baselines.
      Record fresh tier counts for both bundles here.
- [ ] 0.2 **Fixture documents for missing feature types.** The two real docs
      contain no revolve/sweep/loft/thicken/mirror/hole history. Author one or
      more Onshape test documents (via API: create document → add features via
      `POST .../features`, or manually if simpler) exercising: revolve
      (FULL + BLIND + ADD/REMOVE), sweep (single-curve path in a second
      sketch), loft (two parallel-plane profiles, no guides), thicken-from-face,
      mirror across a translated cPlane, transform distance, booleans on
      parametric producers, extrude UP_TO_FACE/NEXT and two-side. Capture with
      `--rollback-snapshots`. For each new behavior also add a checked-in
      **transcript fixture** (pattern: `src/cli/commands/onshape-capture/fixtures/capture-bundle-fixture.ts`)
      or synthetic bundle (pattern: `wave-a-capture-fixtures.ts`) so CI covers
      it without the proprietary bundle.
- [x] 0.3 **Plan-dump dev command.** Tiny script (`scripts/onshape-plan-dump.ts`)
      that validates a bundle, runs `readPartStudio` + `planStudioFidelity`
      (and optionally the probe-backed review via provider), and prints the
      per-feature tier/reason table. Agents use it for before/after evidence
      in every item below.

## Phase K — Kernel spike (parallel with everything; gates Wave S)

- [ ] K.1 **Durable-naming pre-8.0 feasibility spike (no production code).**
      Investigate whether per-feature rebuild-stage naming state + sketch
      profile-generation lineage can be added to the current OCC 7.x shim so
      the `test.fails` release gate in
      `src/domain/modeling/occ/topological-naming.spec.ts` (topology-changing
      sketch edit) passes with honest zero/one/many successor classification.
      Deliverable: decision doc `docs/architecture/durable-naming-pre8-spike.md`
      with (a) feasible → concrete task list appended to this plan as Phase K2,
      or (b) infeasible → explicit deferral to the BRepGraph migration
      (`openspec/changes/modernize-occ-kernel-topology`) and Wave S stays
      gated. Nearest-geometry matching is not an acceptable outcome.
- [ ] K.2 *(only if K.1 says feasible)* Implement, flip
      `supportsDurableTopologyNaming`, delete the `test.fails` gate.

## Phase T — Translator breadth (parallel wave; each item independent)

Each item: extend/split the translator + `.spec.ts` + apply-pipeline coverage +
specific reason codes for the combos that stay degraded + plan-dump evidence on
the relevant capture. All these target contract surface that already executes
in OCC — no kernel changes allowed in this wave.

- [ ] T.1 **Extrude extents & scope.** Support `UP_TO_FACE`/`UP_TO_NEXT`/
      `UP_TO_PART` via the exact-prefix topology resolver (same machinery as
      the existing bespoke `UP_TO_VERTEX` promotion — generalize it, delete the
      bespoke path), two-side extrudes, `draftAngle`, and multi-body
      `booleanScope: targetBodies` (explicit scope queries resolved as body
      slots instead of the current unconditional `needs-history-probe` at
      `extrude-planner.ts:230`). Ambiguous no-scope multi-body cases keep a
      specific reason code.
- [ ] T.2 **Revolve breadth + honest diagnostics.** Split the collapsed
      `revolve-axis-unresolved` catch-all into per-cause codes (operation,
      bodyType, profile, axis, extent). Add: ADD/REMOVE/INTERSECT via deferred
      body scope (reuse extrude's boolean lineage logic), two-direction/
      symmetric extents, axis from a construction line in another parametric
      sketch (`sketchIdOf` deferred) and from canonical datum axes.
- [ ] T.3 **Sweep single-path.** Parametric when the profile resolves via the
      shared region resolver and the path query resolves to exactly one solved
      line/arc/circle entity in another parametric sketch (`sketchIdOf` +
      entityId deferred, mirroring the revolve axis mechanism). Multi-curve
      chains keep `sweep-path-unresolved` with copy saying why.
- [ ] T.4 **Loft simple form.** Parametric for ordered `sheetProfilesArray`/
      `wireProfilesArray` entries that each resolve to one region on a
      parametric sketch (multiple `regionOf` deferred profiles — the
      cross-action machinery already supports N actions), default conditions,
      no guides, not periodic. Guides/conditions/periodicity degrade with
      distinct reason codes instead of the blanket `loft-profile-unresolved`.
- [ ] T.5 **Mirror/transform beyond canonical datums.** Accept translated
      cPlanes (the `plane-from-captured-frame` constructions) as mirror planes
      and transform distance references via `constructionOf` deferreds;
      currently only canonical datum planes pass
      (`wave-b-body-feature-translators.ts:64-80`). Transform rotation and
      copy remain out of scope with their existing codes.
- [ ] T.6 **Chamfer width forms within the existing contract.** Audit what the
      cadara chamfer contract + OCC executor actually accept beyond
      equal-offsets (two distances? distance+angle?). Translate every form the
      contract can express; keep `chamfer-style-unsupported` only for the
      rest. Note: chamfer stays plan-gated on durable naming (Wave S) — this
      item makes the translation ready so the gate-flip is a one-liner.
- [ ] T.7 **Shell non-hollow audit.** Same pattern as T.6: if the contract's
      shell can express Onshape's non-hollow (offset) shell, translate it;
      otherwise keep the reason code and document why in the translator.

## Phase B — Bake-cascade containment (sequential; biggest fidelity multiplier)

Today `state.bakedLineageFeatureIds` + `requiresStudioBake` mean the first
baked feature converts the entire downstream history into one final-state
mesh, and later parametric-eligible solids import suppressed
(`fidelity-planner.ts:11-13`). v2 rollback snapshots make this unnecessary.

- [ ] B.1 **Design doc first** (`docs/architecture/onshape-bake-segments.md`):
      segment the history into parametric runs and baked runs; each baked run
      materializes one `bakedBody` checkpoint from the rollback snapshot of
      its last feature (machinery exists in `rollback-bake.ts`); downstream
      parametric consumers resolve bodies out of the checkpoint via the
      existing exact-prefix resolver + apply-time rematch. Must answer:
      checkpoint body identity across segments, interaction with
      `replaceBodyOutputs`, diagnostics shape, and what happens when a
      snapshot is missing (v1 bundles keep today's whole-studio semantics —
      no behavior change without snapshots).
- [ ] B.2 **Planner: segment-aware lineage.** Replace the boolean
      first-bake poisoning with per-segment tracking; a feature downstream of
      a baked segment plans parametric when all its consumed bodies/regions
      are reachable from checkpoint + parametric prefix. `downstream-of-baked`
      only when genuinely blocked.
- [ ] B.3 **Provider/orchestrator: checkpoint emission.** Emit interleaved
      bakedBody checkpoint actions in `orderedActions`; wire deferred body
      refs (`bodyOf` / `topologyOf`) to checkpoint outputs; apply-time rematch
      unchanged. Whole-studio bake retained only for v1/no-snapshot bundles.
- [ ] B.4 **Real-capture evidence.** Mounts target: Sketch 2 → Extrude 2
      chain imports parametrically on top of a Transform 1 checkpoint
      (Transform 1 itself stays baked — rotation is out of scope). Part
      Studio 1 target: Boolean 1 / Delete part 1 / Split 1 promote once their
      upstream producers exist as checkpoint bodies (the 2026-07-16 audit
      showed they resolve automatically when the prefix carries the bodies).
      Record before/after tier counts here.

## Phase S — Subtopology gate flip (only after K.2; otherwise skipped)

- [ ] S.1 Flip the plan-time gate for fillet/chamfer/shell/thicken and
      sketch-on-probed-face; the translators and resolver paths already exist
      (T.6/T.7 made them current). Re-run both real captures; chamfers in both
      documents should promote. Hole remains `hole-executor-unavailable`.

## Phase V — Integration & verification (sequential, last)

- [ ] V.1 Review-form copy for every new/changed reason code; per-tier counts
      asserted in provider/planner specs against transcript fixtures.
- [ ] V.2 Import all captures (two real + Phase-0 fixture docs) via plan-dump
      and the browser; record final tier tables here. Targets: Mounts
      ≥ 8 parametric (only Transform 1 + gated Chamfer 1 baked without K.2);
      fixture docs: revolve/sweep/loft/boolean/mirror/transform parametric.
- [ ] V.3 Playwright interactive verification extending
      `e2e/onshape-import-parametric.spec.ts`: edit revolve angle / sweep
      profile / loft profile sketches and confirm rebuild; verify checkpoint
      bodies survive upstream parametric edits; drag constrained sketches.
- [ ] V.4 `bun run test:all` green, including e2e.

## Execution notes for the orchestrator

- Dependency graph: 0.1–0.3 first (parallel). Then Phase T items T.1–T.7 all
  parallel (they touch disjoint translator files; shared files
  `fidelity-planner.ts`/`provider.ts` only for registry lines + reason-code
  union — rebase-trivial). K.1 runs in parallel with everything. Phase B is
  sequential after T (B.2 touches planner state all T items read). S after K.2
  and T.6/T.7. V last.
- Each agent gets: this file, the relevant translator file(s),
  `docs/architecture/onshape-topology-reference-resolution.md`, and must run
  `scripts/onshape-plan-dump.ts` before/after on the affected capture.
- Never commit `*.onshape-capture.json` (gitignored) or print `.envrc`
  contents. API creds come from the environment (`direnv` or
  `source .envrc`; the "command not found" noise from sourcing is expected).

## Reference: current translator behavior (2026-07-18)

| featureType | parametric when | otherwise |
|---|---|---|
| assignVariable | always | — |
| newSketch | canonical datum plane (+ provider promotions: translated cPlane frame, probed face — latter gated) | `needs-history-probe` |
| defaultPlane/cPlane | provider promotion from captured frame when a dependent sketch needs it | `needs-history-probe` |
| extrude | 1 sketch, parametric+solved, BLIND/SYMMETRIC/THROUGH_ALL, resolvable regions, NEW or single-upstream-body boolean | `needs-region-resolution`, `unsupported-feature` (UP_TO_*), `needs-history-probe` (explicit scope / multi-body) |
| revolve | same-sketch line axis, SOLID, NEW, FULL/one-direction | `revolve-axis-unresolved` (collapsed catch-all) |
| sweep / loft / thicken | never | `sweep-path-unresolved` / `loft-profile-unresolved` / `thicken-requires-topology` |
| booleanBodies / deleteBodies / splitPart / transform / mirror | body-only topology candidates; promote via exact-prefix probe when all consumed bodies live in parametric prefix | `topology-upstream-baked`, param-specific codes |
| fillet / chamfer / shell | translate + resolve, then plan-gated | `topology-durable-naming-unavailable` |
| hole | never (no OCC executor — out of scope) | `hole-executor-unavailable` |
| patterns / draft / rib / primitives / curves / direct-edit / derived | out of scope | Wave-C family codes |

## Verification notes / tier counts

(filled in by agents as work lands)
