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
apply-pipeline coverage against the tracked curated captures in
`test/fixtures/onshape-captures`). After each item: `bun run test:all` relevant slices green.

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

- [x] 0.1 **Restore the second capture + make real-bundle specs skip cleanly.**
      Recapture `9841e486906fa2ce62d74d8e` with automatic proven-boundary
      snapshots into the repo root (stays gitignored). Change every spec that loads root
      `*.onshape-capture.json` (fidelity-planner, provider, apply-pipeline,
      e2e helpers) to `test.skipIf(!existsSync(...))` instead of failing, so CI
      and fresh clones stay green while local runs still pin tier baselines.
      Record fresh tier counts for both bundles here.
- [x] 0.2 **Fixture documents for missing feature types.** The two real docs
      contain no revolve/sweep/loft/thicken/mirror/hole history. Author one or
      more Onshape test documents (via API: create document → add features via
      `POST .../features`, or manually if simpler) exercising: revolve
      (FULL + BLIND + ADD/REMOVE), sweep (single-curve path in a second
      sketch), loft (two parallel-plane profiles, no guides), thicken-from-face,
      mirror across a translated cPlane, transform distance, booleans on
      parametric producers, extrude UP_TO_FACE/NEXT and two-side. Capture with
      automatic proven-boundary snapshots. For each new behavior also add a checked-in
      **transcript fixture** (pattern: `src/cli/commands/onshape-capture/fixtures/capture-bundle-fixture.ts`)
      or synthetic bundle (pattern: `wave-a-capture-fixtures.ts`) so CI covers
      it without the proprietary bundle.
- [x] 0.3 **Plan-dump dev command.** Tiny script (`scripts/onshape-plan-dump.ts`)
      that validates a bundle, runs `readPartStudio` + `planStudioFidelity`
      (and optionally the probe-backed review via provider), and prints the
      per-feature tier/reason table. Agents use it for before/after evidence
      in every item below.

## Phase K — Kernel spike (parallel with everything; gates Wave S)

- [x] K.1 **Durable-naming pre-8.0 feasibility spike (no production code).**
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
- [x] K.2 **Implement semantic per-feature stage naming (feasible; medium-high risk).**
      Decision and evidence: `docs/architecture/durable-naming-pre8-spike.md`.
      No geometry/traversal matching is permitted; Wave S remains gated until
      K.2.7 flips the capability.
  - [x] K.2.1 **Retain feature-stage state.** Add internal
        `src/domain/modeling/occ/topology-stage.ts`; thread old/current stages by
        feature/output slot through `authoring-state.ts` and `features/shared.ts`.
        JS only, no Wasm rebuild. Verify rebuild, reorder, and suppression do not
        cross-associate stages.
  - [x] K.2.2 **Retain sketch profile provenance.** In `sketch-profile.ts`, reuse
        OCC vertices by `SketchPointId` and return edges/vertices keyed by
        `SketchEntityId` or projected-reference key; unsupported approximations
        are explicit. JS only. Verify line/arc/circle/projected source maps and
        deleted source IDs.
  - [x] K.2.3 **Project provenance through extrude history.** In `features/extrude.ts`,
        query the already-bound prism `Generated`/`FirstShape`/`LastShape` APIs
        before disposing builders; key profile slot/end roles and compose available
        draft/boolean history. JS only; current recipe is sufficient. Verify full
        rectangle topology coverage, dimension one-successor, rectangle→triangle
        zero-successor, and two-side/multi-profile/unsupported-draft outcomes.
  - [x] K.2.4 **Reconcile before downstream execution.** In `topology-naming.ts`,
        `topology.ts`, and `authoring-state.ts`, classify exact semantic keys as
        zero/one/many, preserve old IDs only for one-to-one claims, and install
        deleted/ambiguous/unsupported invalidations before the next feature. JS
        only. Verify downstream fillet either receives the proved ID or fails with
        a structured invalid-reference diagnostic before OCC execution.
  - [x] K.2.5 **Close fresh-ID resurrection.** In `topology.ts` and feature
        reference preconditions, quarantine fresh new-body ID collisions without
        stage proof. JS only; this is independently shippable as the honest-deleted
        partial. Verify exact delete/recreate remains invalid while a proved
        semantic successor stays live.
  - [x] K.2.6 **Cover producers conservatively.** Add revolve source roles in
        `features/revolve.ts`; audit draft/sweep/loft/thicken/face-backed/multi-result
        paths. Every unsupported path invalidates rather than remaps. Add a native
        shim transaction and rebuild Wasm only if profiling/evidence shows the
        existing bindings cannot carry a required relation; mark it for BRepGraph
        deletion. Verify every executable new-body producer proves successors or
        reports unsupported history.
  - [x] K.2.7 **Qualify and flip.** Logic lane at the OCC authored-rebuild/reference
        seam: remove `test.fails`, pin zero/one/many plus coincident-recreate and
        unsupported cases, retain dimension/reorder/suppression coverage, then flip
        `supportsDurableTopologyNaming`. Run the focused Vitest file and
        `bun run test:all`; only then unblock Phase S.

## Phase T — Translator breadth (parallel wave; each item independent)

Each item: extend/split the translator + `.spec.ts` + apply-pipeline coverage +
specific reason codes for the combos that stay degraded + plan-dump evidence on
the relevant capture. All these target contract surface that already executes
in OCC — no kernel changes allowed in this wave.

- [x] T.1 **Extrude extents & scope.** Support `UP_TO_FACE`/`UP_TO_NEXT`/
      `UP_TO_PART` via the exact-prefix topology resolver (same machinery as
      the existing bespoke `UP_TO_VERTEX` promotion — generalize it, delete the
      bespoke path), two-side extrudes, `draftAngle`, and multi-body
      `booleanScope: targetBodies` (explicit scope queries resolved as body
      slots instead of the current unconditional `needs-history-probe` at
      `extrude-planner.ts:230`). Ambiguous no-scope multi-body cases keep a
      specific reason code.
- [x] T.2 **Revolve breadth + honest diagnostics.** Split the collapsed
      `revolve-axis-unresolved` catch-all into per-cause codes (operation,
      bodyType, profile, axis, extent). Add: ADD/REMOVE/INTERSECT via deferred
      body scope (reuse extrude's boolean lineage logic), two-direction/
      symmetric extents, axis from a construction line in another parametric
      sketch (`sketchIdOf` deferred) and from canonical datum axes.
- [x] T.3 **Sweep single-path.** Parametric when the profile resolves via the
      shared region resolver and the path query resolves to exactly one solved
      line/arc/circle entity in another parametric sketch (`sketchIdOf` +
      entityId deferred, mirroring the revolve axis mechanism). Multi-curve
      chains keep `sweep-path-unresolved` with copy saying why.
- [x] T.4 **Loft simple form.** Parametric for ordered `sheetProfilesArray`/
      `wireProfilesArray` entries that each resolve to one region on a
      parametric sketch (multiple `regionOf` deferred profiles — the
      cross-action machinery already supports N actions), default conditions,
      no guides, not periodic. Guides/conditions/periodicity degrade with
      distinct reason codes instead of the blanket `loft-profile-unresolved`.
- [x] T.5 **Mirror/transform beyond canonical datums.** Accept translated
      cPlanes (the `plane-from-captured-frame` constructions) as mirror planes
      and transform distance references via `constructionOf` deferreds;
      currently only canonical datum planes pass
      (`wave-b-body-feature-translators.ts:64-80`). Transform rotation and
      copy remain out of scope with their existing codes.
- [x] T.6 **Chamfer width forms within the existing contract.** Audit what the
      cadara chamfer contract + OCC executor actually accept beyond
      equal-offsets (two distances? distance+angle?). Translate every form the
      contract can express; keep `chamfer-style-unsupported` only for the
      rest. Note: chamfer stays plan-gated on durable naming (Wave S) — this
      item makes the translation ready so the gate-flip is a one-liner.
- [x] T.7 **Shell non-hollow audit.** Same pattern as T.6: if the contract's
      shell can express Onshape's non-hollow (offset) shell, translate it;
      otherwise keep the reason code and document why in the translator.

## Phase B — Bake-cascade containment (sequential; biggest fidelity multiplier)

Today `state.bakedLineageFeatureIds` + `requiresStudioBake` mean the first
baked feature converts the entire downstream history into one final-state
mesh, and later parametric-eligible solids import suppressed
(`fidelity-planner.ts:11-13`). v2 rollback snapshots make this unnecessary.

- [x] B.1 **Design bake segments.** Decisions, fallback invariants, acceptance targets, and one-commit B.2/B.3 task breakdown: `docs/architecture/onshape-bake-segments.md`.
- [x] B.2 **Planner: segment-aware lineage.** Implement `StudioBakeStrategy`, rollback body-delta/replacement-closure segments, and checkpoint-aware reachability; retain the exact legacy planner for v1/no-snapshot/preflight-failed studios (task order in the design doc).
  - [x] B.2.1 **Rollback body-delta primitives.** Export exact parsed body
        shape keys and before/after delta extraction for introduced, changed,
        removed, and unchanged deterministic body IDs.
  - [x] B.2.2 **Segment + replacement-closure planner.** Purely plan baked runs,
        selective checkpoint outputs, carried producer siblings, transitive
        checkpoint replacement, body bindings, and exact legacy preflight.
  - [x] B.2.3 **Dependency reachability replaces global poisoning.** Translators
        declare sketch, body, and topology-query inputs; legacy planning degrades
        only features whose declared dependency is unreachable, while checkpoint
        body lineage can be marked reachable by the segment planner.
  - [x] B.2.4 **Studio bake-strategy integration.** Fidelity planning selects
        none/segments/whole-studio legacy, replans reviewer demotions, exposes
        segment diagnostics, and prints checkpoint details in plan-dump output.
- [x] B.3 **Provider/orchestrator: checkpoint emission.** Emit selective interleaved checkpoints, preserve deterministic body identity through `bodyOf`/`topologyOf`, share body-only mesh signatures for prefix/apply rematch, and add segment review diagnostics (task order in the design doc).
  - [x] B.3.1 **Deterministic checkpoint source-body identity.** Encode only the
        planner-selected output/carried bodies in rollback order, key baked-mesh
        components by Onshape deterministic body ID, and retain the segment
        provenance span plus exact replacement-action closure.
  - [x] B.3.2 **Shared body-signature derivation.** Share native and body-only
        mesh body-signature derivation between exact-prefix review and apply-time
        rematching, and require `bodyOf` producers to have exactly one output.
  - [x] B.3.3 **Selective interleaved checkpoint actions.** Emit one planner-selected
        `bakedBody` checkpoint at each segment boundary with selective replacement
        scope while preserving complete ordered-action permutations.
  - [x] B.3.4 **Body reference wiring + apply fallbacks.** Emit `bodyOf` only for
        proved single-output producers, use body `topologyOf` for attributed
        multi-output checkpoints, and keep selective post-feature fallbacks at the
        consumer's ordered position so downstream actions continue.
  - [x] B.3.5 **Captured-frame sketch after body-only checkpoint.** Emit a visible
        explicit-frame construction plane from unique captured planar evidence,
        then support the promoted sketch through `constructionOf` without claiming
        checkpoint face topology.
  - [x] B.3.6 **Review-form segment presentation.** Show strategy and checkpoint
        summaries, segment body/replacement details, preflight diagnostics, and
        per-feature checkpoint context without replacing intrinsic reasons.
  - [x] B.3.7 **Synthetic apply-pipeline integration matrix.** Apply two
        separated baked runs end-to-end with neutral entries, multi-body
        attribution/replacement closure, successful checkpoint rematching,
        same-position fallback, downstream continuation, and legacy-v1
        equivalence.
- [x] B.4 **Real-capture evidence.** Mounts target: Sketch 2 → Extrude 2
      chain imports parametrically on top of a Transform 1 checkpoint
      (Transform 1 itself stays baked — rotation is out of scope). Part
      Studio 1 target: Boolean 1 / Delete part 1 / Split 1 promote once their
      upstream producers exist as checkpoint bodies (the 2026-07-16 audit
      showed they resolve automatically when the prefix carries the bodies).
      Record before/after tier counts here.

      | Capture / studio | Before Phase B | After checkpoint-prefix review | Required promotions |
      |---|---:|---:|---|
      | Mounts (`865452a3e2270f0ebca3ce63`) | 6 / 4 / 0 | 8 / 2 / 0 | Sketch 2 and Extrude 2 are parametric above the Transform 1 checkpoint; Transform 1 remains baked (`transform-rotation-unsupported`). |
      | Part Studio 1 (`a294dd6e940aa00fdcb206dc`) | 6 / 35 / 0 | 14 / 27 / 0 | Split 1, Boolean 1, and Delete part 1 are parametric from uniquely attributed checkpoint bodies. |

      Counts are parametric / baked / geometryOnly. Part Studio 1 also promotes
      Incline, Screen Outline, Chamfer 1, Extrude 8, and Extrude 13 from the
      already-landed translator and durable-naming work when reviewed against
      exact rollback-prefix body evidence.

## Phase S — Subtopology gate flip (only after K.2; otherwise skipped)

- [x] S.1 Flip the plan-time gate for fillet/chamfer/shell/thicken and
      sketch-on-probed-face; the translators and resolver paths already exist
      (T.6/T.7 made them current). Re-run both real captures; chamfers in both
      documents should promote. Hole remains `hole-executor-unavailable`.

## Phase V — Integration & verification (sequential, last)

- [x] V.1 Review-form copy for every new/changed reason code; per-tier counts
      asserted in provider/planner specs against transcript fixtures.
- [x] V.2 Import all captures (two real + Phase-0 fixture docs) via plan-dump
      and the browser; record final tier tables here. Targets: Mounts
      ≥ 8 parametric (only Transform 1 + gated Chamfer 1 baked without K.2);
      fixture docs: revolve/sweep/loft/boolean/mirror/transform parametric.
      Plan-dump acceptance is complete; the browser half remains pending because
      Playwright Chromium is unavailable in this environment.
- [x] V.3 Playwright interactive verification extending
      `e2e/onshape-import-parametric.spec.ts`: edit revolve angle / sweep
      profile / loft profile sketches and confirm rebuild; verify checkpoint
      bodies survive upstream parametric edits; drag constrained sketches.
      Real-kernel tier tables, the four-test regression root causes, and new
      coverage list are recorded below.
- [x] V.4 `bun run test:all` green, including e2e. Final counts: lint clean;
      build green; logic 497 + ui 125 + static 24 = 646 non-E2E tests passed;
      `playwright test` 61/61 passed. See verification note below.

## Phase W — Remaining parametric gap (complete; residuals documented)

Current review plans: Mounts **8/2/0**, Part Studio 1 **14/27/0**. The 27
baked PS1 features decompose into: 9 sketches-on-body-faces
(`needs-history-probe`) which cascade-block 14 downstream extrudes
(`needs-region-resolution`), 2 chamfers failing edge matching
(`topology-reference-no-match`), 1 chamfer style, 1 hollow shell.

- [x] W.1 **Sketch-on-face promotion** — ~85% of the remaining PS1 gap; pure
      importer work; unlocks recursively (each promoted sketch unlocks its
      extrudes, whose bodies unlock the next sketch). PS1 target: 14 → ~37/41.
      The `sketch-on-probed-face` promotion path exists and durable naming is
      qualified, but it never fires on the real bundle:
      (a) diagnose why captured/inferred face signatures never match prefix
      probe signatures (evidence quality, planar-face-only path, promotion
      loop preconditions — see provider.ts:987 area);
      (b) capture side: sketch-plane queries may need resolution at each
      sketch's rollback index, not only unresolved-at-final IDs
      (src/cli/commands/onshape-capture/references.ts);
      (c) apply side: commit a sketch on a live body face
      (`SketchPlaneSupportRef` face support) with apply-time rewiring, same
      pattern as `constructionOf`; prove with real-kernel e2e (mock/real
      divergence is exactly where regionOf-class bugs hide).
- [x] W.2 **Chamfer edge signature matching** — 2 PS1 chamfers + Mounts
      Chamfer 1 report `topology-reference-no-match`; edge signatures
      (bbox/centroid) are too weak/ambiguous on symmetric parts. Enrich
      signatures (edge endpoints + owning-face pair) or capture deterministic
      edge adjacency; diagnose with plan-dump + probe tooling.

  **Verification (done).** Root cause was not weak signatures: the plan-dump
  review mock reflected captured edge probes at mixed units (bbox in mm,
  `definingData`/centroid in meters), so exact-tolerance matching never fired
  on symmetric parts. Fix is pure importer/harness-side: normalize review
  probe signatures to mm before matching (no capture-side enrichment, no
  recapture, no nearest-geometry scoring — durable-naming exact-tolerance is
  preserved). Added matcher + resolver→prepare regression specs proving
  symmetric/mirror edges each resolve to their own distinct live edge and
  degrade honestly to `topology-reference-ambiguous` when genuinely coincident.

  Mock plan-dump (`--review`) tier counts before → after:

  | bundle | plain | review before | review after |
  |---|---|---|---|
  | PS1 `9841e486…` | 6/35/0 | 22/19/0 | **24/17/0** |
  | Mounts `40a51fb8…` | 8/2/0 | 8/2/0 | **9/1/0** |
  | Wave T `405fa226…` | 2/0/0 | 2/0/0 | 2/0/0 (collateral, unchanged) |

  Per-chamfer (mock review): PS1 Chamfer 1 parametric (unchanged); PS1 Chamfer 2
  (5 lines) & Chamfer 4 (4 circles) no-match → **parametric**; PS1 Chamfer 3
  stays baked `chamfer-style-unsupported` (**W.4**, out of scope); Mounts
  Chamfer 1 no-match → **parametric**.

  **Real-kernel divergence (open acceptance gate).** The `test:e2e`
  real-kernel tiers are *unchanged*: Mounts stays **8/2/0** and PS1 stays
  **8/33/0** because the fix was harness/matcher-side (mock review) only and
  touched no production import code. The real OCC parametric-prefix rebuild
  does not yet expose the chamfer edges those signatures match, so the chamfer
  features are not promoted into the real-kernel timeline (Mounts Transform 1
  is still baked — **W.3**; Mounts baked body remains `feature_bakedBody-1`).
  W.2 is complete for the probe-backed review lane; closing the real-kernel gap
  is the OCC-backed replay / browser-lane acceptance gate tracked as a
  follow-up.

  **Real-kernel acceptance-gate follow-up (W-realkernel).** Diagnosed and
  pinned across a 4-step sub-plan:
  - *Diagnosis* (node-side real-OCC harness `realkernel-diag.spec.ts` under
    `scripts/tmp/`; scratch, removed at finalize): the mock echoes captured
    signatures as probe signatures (guaranteed self-match), proving matcher +
    units only. **Root cause A** — PS1 extrudes bake, so the real probe prefix
    has zero solid bodies (`probeCount 0`) and every consumer no-matches with
    an empty rejection list. **Root cause B** — Mounts Chamfer 1's captured
    edge is recorded in the construction-plane (feature-local) frame
    (`center [-4,9,0]`, `axis +Z`, y=9 is outside the body's y-range [0,4]),
    so it never lines up with the real world-frame OCC hole edges
    (`center [-4,{0,4},5]`, `axis ±Y`, same radius 2.05). Frame mismatch, not
    units.
  - *Fix #1* (step 2): dropped the partial `scaleCapturedSignatureToDocument
    Units` scaler; both match sides now normalize `definingData` identically.
  - *Specs + evidence* (step 3): `realkernel-acceptance-gate.spec.ts` feeds the
    real-kernel-captured signatures (not mock echoes) through the matcher and
    resolver, pinning root causes A and B and the world-frame positive control
    that fix #2 must satisfy. The plan-dump mock's self-match caveat is now
    documented inline pointing at this pin, so the mock can no longer
    green-light a real acceptance-gate failure without this suite going red.
    (No vitest baseline pins the mock 24/17/0 · 9/1/0 counts, so none changed.)
  - *E2E + finalize* (final step): the browser is the true acceptance gate, and
    it disproved the node harness's promotions. The node-side real-OCC harness
    (`realkernel-diag.spec.ts`, now deleted) reported Mounts **9/1/0** and PS1
    **9/32/0**, but neither survives the worker-backed browser lane / apply:

    - **Mounts Chamfer 1 (harness 9/1/0 → browser 8/2/0).** Chamfer 1 is the
      last feature, after the *baked* `Transform 1` (rotation → W.3). Its edge
      therefore lives on the tessellation-backed `Transform 1` checkpoint body,
      which exposes only body identity — never the hole edge. The harness/probe
      matched the reframed edge against a probe prefix that *omits* the bake
      (still-parametric pre-transform bodies), so review promoted it; but apply
      rebuilds the chamfer on the checkpoint body and its live topology rematch
      fails (`Live topology rematch failed …`, confirmed node-side against real
      OCC). This was a silent review→apply over-promotion. **Fix (this step):**
      the provider now degrades any face/edge consumer sitting behind a baked
      transform (non-null capture→world transform + non-body slots) to
      `topology-upstream-baked`, so review == apply == browser at **8/2/0**.
      Recovering Chamfer 1 needs `Transform 1` to be parametric first (**W.3**),
      not a reframe against the wrong prefix. This also makes the *mock*
      plan-dump honest: Mounts review dropped **9/1/0 → 8/2/0** (superseding the
      W.2 mock table above).
    - **PS1 Extrude 8 (harness 9/32/0 → browser 8/33/0).** The whole-body
      checkpoint-materialization path (probe prefix emits bake checkpoints for
      body-only consumers) lets a body-scope extrude match a checkpoint body in
      the *direct-OCC* node harness (shared geometry-asset store). In the
      worker-backed browser probe the checkpoint body rebuilds without the same
      shared bytes, so Extrude 8 is not promoted and PS1 stays **8/33/0**. The
      materialization code is forward-correct and browser-inert (mock 24/17/0
      and browser 8/33/0 are both unaffected); genuine PS1 face/edge/body
      recovery is gated on **W.1** (every PS1 body-producing extrude bakes at
      region resolution, so no parametric body is ever exposed to probe).

    `e2e/onshape-import-parametric.spec.ts` asserts the honest browser tiers
    (Mounts **8/2/0**, PS1 **8/33/0**; PS1 `Split 1` / `Boolean 1` /
    `Delete part 1` baked-suppressed `topology reference did not match`; Mounts
    parametric extrudes survive a `nail` edit + Extrude 1 depth edit; PS1 walls
    survive a `walls` edit; Wave T Revolve/Sweep/Mirror timelines). Deleted the
    `scripts/tmp/` scratch harness.

    **Final tier tables (mock vs real browser gate).** All divergence is now
    honest and pinned, not silent:

    | bundle | mock plain | mock review | real (browser e2e gate) |
    |---|---|---|---|
    | PS1 `9841e486…` | 6/35/0 | 24/17/0 | **8/33/0** |
    | Mounts `40a51fb8…` | 8/2/0 | **8/2/0** | **8/2/0** |
    | Wave T `405fa226…` | 2/0/0 | 2/0/0 | Revolve 4/0/0 · Sweep 3/0/0 · Mirror 3/2/0 |

    Mounts mock now equals the browser (the new gate removed the sole
    over-promotion). PS1 mock still over-promotes by 16 (24→8) versus the
    browser: **root cause A / W.1** — PS1 extrudes bake at region resolution, so
    the real parametric prefix has no solid body for any downstream consumer to
    probe. No production code was forced to fake a promotion.

  - *Remaining honest residuals* (tracked follow-ups):
    - **A1 / W.1** — every PS1 body-producing extrude bakes at region
      resolution; genuine PS1 face/edge/body parametric recovery is gated on it
      (extrudes must go parametric before any downstream consumer can probe a
      real body). This is the entire PS1 mock↔browser delta.
    - **Mounts Chamfer 1 / W.3** — permanently baked (`topology-upstream-baked`)
      until `Transform 1` (rotation) becomes parametric; a face/edge over a
      tessellation-backed checkpoint body is structurally unrecoverable by
      design.
    - **Checkpoint materialization is browser-inert** — the whole-body
      checkpoint probe path promotes in the direct-OCC harness only; the
      worker-backed browser probe does not rebuild checkpoint bytes into the
      probe, so it never changes the browser gate. Kept as forward-correct.
    - The `reframeSignature` / `computeCaptureFrameToWorld` machinery is
      retained: `computeCaptureFrameToWorld` is the signal the new gate keys on,
      and reframing still applies to whole-body consumers behind a baked
      transform. `realkernel-acceptance-gate.spec.ts` keeps the reframe as a
      mechanism-only control, explicitly noting apply keeps Chamfer 1 baked.
- [x] W.3 **Transform rotation** (contract+kernel, small) — rotation option on
      the transform advanced-solid feature; `gp_Trsf` rotation in the existing
      executor. Unlocks Mounts Transform 1 + Chamfer 1: Mounts is now fully
      parametric at **10/0/0** and the checkpoint body is gone.

  **Verification (done).** Final before/after: originally Mounts was **8/2/0**;
  after W.2 / real-kernel honesty it was **9/1/0**; W.3 mock + real browser
  review now report **10/0/0**. `Transform 1` and `Chamfer 1` are parametric,
  `feature_bakedBody-1` is no longer emitted, and the live body lineage remains
  `body_feature_extrude-1` through in-place extrude/transform/chamfer updates.

  Mechanism: rotation axes use `sketchEntity` references resolved through
  `sketchIdOf` + entity id; OCC executes rotation via `gp_Trsf`; rigid transform
  topology keeps exact topology-stage lineage; exact-BREP ids are canonicalized
  for apply rematch; consumer history avoids double-reframing; imported Chamfer
  distance is materialized through the authored-value wrapper.

  Browser coverage: `e2e/onshape-import-parametric.spec.ts` asserts the Mounts
  review count **10 parametric / 0 baked / 0 geometry-only**, the no-checkpoint
  feature timeline (`Extrude 1`, support plane, `Extrude 2`, `Transform 1`,
  `Chamfer 1`), constrained Sketch 2 drag, variable geometry rebuild, and
  Extrude 1 edit coverage. Full-parametric Mounts milestone is satisfied.
- [x] W.4 **Chamfer two-distance / distance+angle** (contract plumbing; OCC
      `Add_3` already accepts two distances). Unlocks PS1 Chamfer 3.

  **Verification (done).** Chamfer advanced-solid options now carry an explicit
  width form: `equalOffsets` (`distance`), `twoOffsets` (`distance1` +
  `distance2`), and `offsetAngle` (`distance` + angle in degrees). The OCC
  executor keeps the native equal-offset transaction path, uses
  `BRepFilletAPI_MakeChamfer.Add_3(distance1, distance2, edge, face)` for
  unequal offsets, and uses bound `AddDA(distance, angleRadians, edge, face)`
  for distance+angle. Distance+angle is executable only for finite angles
  greater than 0 and less than 90 degrees; 0/90-degree degenerate inputs stay
  rejected before OCC. Because imported durable edge targets do not carry a
  selected owning face, `distance1` is assigned to the stable first adjacent
  face returned by the OCC edge→face ancestor map and `distance2` to the other
  face.

  Onshape translator support: `FACE_OFFSET` + `EQUAL_OFFSETS`, `TWO_OFFSETS`
  (`width1`/`width2`; PS1 Chamfer 3 captures 3 mm + 5 mm), and `OFFSET_ANGLE`
  (`width` + `angle`). Other chamfer methods remain
  `chamfer-method-unsupported`; genuinely unsupported styles remain
  `chamfer-style-unsupported`; malformed supported widths/angles remain
  `chamfer-width-unreadable`.

  Plan-dump evidence (counts are parametric / baked / geometryOnly): PS1 mock
  review moved **24 / 17 / 0 → 25 / 16 / 0**, with Chamfer 3 now parametric.
  Mounts browser e2e remains **10 / 0 / 0**; local plan-dump review for the
  Mounts fixture reported **9 / 1 / 0** with Chamfer 1 still no-match, an
  existing review/probe divergence unrelated to W.4. Wave-T first-studio review
  remains **2 / 0 / 0**. Real browser PS1 remains **8 / 33 / 0** because the
  current browser/import prefix still stops before the Chamfer 3 topology is
  live; the per-feature translator and OCC executor seams prove the width form.

  Tests: focused OCC executor + contract specs, Onshape translator/provider
  preparation + apply-pipeline specs, `src/domain/import/onshape` and
  `src/contracts/modeling` logic suites, build, changed-file lint,
  `bun run test:e2e`, and final `bun run test:all`.
- [x] W.5 **Shell non-hollow / offset-all-faces**: added the general
      whole-solid offset branch using the bound `BRepOffsetAPI_MakeOffsetShape.PerformByJoin`
      API. This does **not** unlock PS1 Shell 1: recovered OCC/Onshape evidence
      showed PS1 Shell 1 is `isHollow=true`, `entities=[]`, and preserves the
      outer envelope as a closed hollow, which is geometrically different from a
      whole-solid offset that changes the bounding box.
- [x] W.6 **Hole executor** (largest kernel item; no instances in current
      bundles) — parametric simple/counterbore/countersink hole subset now
      executes through OCC.

  **Verification (done).** The authored hole contract now carries supported
  Onshape styles (`SIMPLE`, `C_BORE`, `C_SINK`), termination (`BLIND`,
  `THROUGH` / `THROUGH_ALL`), `oppositeDirection`, explicit body scope, and
  sketch-point locations. The OCC executor builds cylindrical cutters for simple
  holes and counterbores, builds a revolved countersink profile for conical
  entries, and subtracts them with boolean cut while retaining the scoped body.
  Location semantics are intentionally sketch-point based: Onshape point-sketch
  locations prepare as deferred `sketchIdOf` targets, then apply resolves them
  to live `sketchId`/`pointId` values before reaching the kernel.

  CI coverage uses the proprietary-free `makeWaveBHoleCaptureBundle()` synthetic
  fixture. The real-OCC logic integration reviews/prepares parametric hole
  actions, applies a base extrude + location sketch + simple blind hole through
  the actual OCC modeling service, verifies a live cylindrical cut/topology
  signature and retained body, then applies a fresh countersink case and verifies
  a live conical face with no kernel errors. The real-OCC case starts from the
  shared fixture and test-clones the rollback body envelope to the real OCC
  cylinder tessellation, while the shared fixture remains compatible with the
  existing mock-provider seam.

  Exact translator degradation reason codes are now: `hole-thread-unsupported`,
  `hole-style-unsupported`, `hole-diameter-unreadable`,
  `hole-termination-unsupported`, `hole-depth-unreadable`,
  `hole-counterbore-parameters-unreadable`,
  `hole-countersink-parameters-unreadable`, `hole-scope-unresolved`, and
  `hole-location-unresolved` (plus topology match/ambiguity codes from the
  shared body-scope resolver). Unsupported remains explicit for threaded,
  tapped, clearance, and standards-driven holes; `UP_TO_NEXT` / `UP_TO_ENTITY`
  style terminations; ambiguous multi-sketch or multi-point location queries;
  and custom start planes or drill/tip geometry.

  Plan-dump evidence (counts are parametric / baked / geometryOnly): real-bundle
  review counts are unchanged because none of the three bundles contains hole
  features. Actual local review counts: Mounts `40a51fb8…` **10 / 0 / 0**
  (plain **8 / 2 / 0**); PS1 `9841e486…` **25 / 16 / 0** (plain **6 / 35 /
  0**); Wave T first studio `405fa226…` **2 / 0 / 0** (plain **2 / 0 / 0**).
  If a local mock review still reports Mounts **9 / 1 / 0**, it is the known
  probe-limitation divergence noted under W.4, not hole fallout.

  Tests: focused contract/OCC/translator/apply specs plus the new real-OCC
  synthetic import integration, then `bun run test:e2e` and `bun run test:all`.
- [x] W.7 **Patterns (linear/circular)** (largest overall; new feature kind
      end-to-end: contract, executor, forms, translator). Current real bundles
      contain no body patterns, so acceptance is pinned by proprietary-free
      synthetic provider→real OCC coverage plus unchanged real-bundle counts.

  **Verification (done).** W.7 adds an executable body-copy boundary only:
  linear and circular Onshape `PART` patterns with resolved seed bodies,
  `operationType=NEW`, finite instance count, explicit linear direction or
  circular axis, linear spacing or circular angle, no second linear direction,
  no centered mode, and no skipped instances. Contract/executor semantics stay
  conservative: pattern features copy whole seed bodies only, never feature/face
  seeds or boolean-merge intent, and output identities are deterministic new
  body copies while seed body topology remains untouched rather than claiming
  source-successor preservation.

  Onshape parameters translate into advanced-solid participants/options:
  `entities` → body seeds, `directionOne`/`axis` → construction plane or sketch
  line references, `instanceCount`, `distance`, `angle`, `oppositeDirection`,
  and circular `equalSpace`. The toolbar pattern dropdown now contains the
  generated authoring tools `linearPattern` and `circularPattern`, plus the
  unsupported `curvePattern` tool, with no duplicate tool ids.

  CI coverage uses the proprietary-free `makeWaveWPatternCaptureBundle()`
  synthetic fixture. Logic acceptance reviews both pattern studios as
  parametric, prepares topology-deferred body-copy actions, applies a linear
  pattern and a circular pattern through the real OCC modeling service, and
  verifies live copied body outputs. No private Onshape pattern bundle or
  file-picker-only fixture was invented.

  Exact unsupported variants and reason codes: non-`PART` pattern types use
  `pattern-type-unsupported` except `FEATURE`, which uses
  `pattern-feature-seed-unsupported`; non-`NEW` operations use
  `pattern-operation-unsupported`; unresolved seed bodies use
  `pattern-seed-unresolved`; unresolved linear directions/axes use
  `pattern-direction-unresolved` / `pattern-axis-unresolved`; invalid count,
  spacing, or angle use `pattern-count-unreadable`,
  `pattern-spacing-unreadable`, or `pattern-angle-unreadable`; second linear
  direction, centered mode, and skipped instances use
  `pattern-second-direction-unsupported`, `pattern-centered-unsupported`, and
  `pattern-skipping-unsupported`. Curve pattern remains `pattern-unsupported`.
  Sketch-, face-, feature-, table-, and skip-instance pattern variants remain
  unsupported.

  Plan-dump evidence (counts are parametric / baked / geometryOnly): real-bundle
  counts are unchanged because none contains body patterns. Actual local counts:
  Mounts `40a51fb8…` plain **8 / 2 / 0**, review **9 / 1 / 0**; PS1
  `9841e486…` plain **6 / 35 / 0**, review **25 / 16 / 0**. Wave T
  `405fa226…` exact plain/review counts by studio: Part Studio 1 **2 / 0 / 0**
  and **2 / 0 / 0**; Revolve remove **4 / 0 / 0** and **4 / 0 / 0**; Sweep
  **3 / 0 / 0** and **3 / 0 / 0**; Loft **1 / 3 / 0** and **4 / 0 / 0**;
  Extrude extents **6 / 0 / 0** and **6 / 0 / 0**; Mirror transform
  **2 / 3 / 0** and **5 / 0 / 0**.

  Tests/regression: existing logic real-OCC importer acceptance covers the
  synthetic fixture boundary; `bun run test:e2e` passed **61 / 61** before
  final docs, and final `bun run test:all` passed lint, build, logic
  **566 / 566**, UI **125 / 125**, static **24 / 24**, and e2e **61 / 61**.

  **Phase W is complete** in the scoped sense that W.1–W.7 are checked off and
  their residuals are documented. This does not make PS1 fully parametric:
  known W.1 region-resolution/sketch-on-face fallout and the closed-hollow Shell
  1 gap remain honest residuals.


## Phase X — Full-parametric local-capture closure (active)

Phase W closed its original scoped work, but did not satisfy the stronger local
acceptance goal: every supported feature in every tracked
`test/fixtures/onshape-captures/*.onshape-capture.json` imports as live parametric history. Phase X supersedes
mock-review tier counts as acceptance. The real browser/worker/OCC apply path is
the gate; `scripts/onshape-plan-dump.ts --review` remains diagnostic only because
it echoes captured signatures and does not rebuild OCC geometry.

Scope and denominator:

- Tracked fixture bundles: `405fa226bb150016d09afc09`, `40a51fb8fa82fd4565151114`,
  `5151a4c877c9493b733ad52f`, `9841e486906fa2ce62d74d8e`, and
  `d3cd9b09c3c36af1dd2efae9`; every Part Studio in each bundle is included.
- Onshape `bodyType=SURFACE` extrudes are the only accepted exclusions. The
  current local captures contain one named `Extrude 4` in each of the `9841`
  and `d3cd9` bundles. They must remain explicitly and honestly unsupported;
  they must never be counted or emitted as solid parametric extrudes. The
  similarly named 5151 `Extrude 4` is a `SOLID`/`REMOVE` feature and remains in
  the required parametric denominator.
- A supported feature is accepted only when it emits no baked/checkpoint
  replacement, is not suppressed, applies through the browser worker and real
  OCC kernel, and survives a representative upstream parameter or sketch edit
  without invalid-reference diagnostics. A parametric review tier alone is not
  acceptance.
- Final tree hygiene: no scratch harnesses, temporary diagnostics, migration
  adapters, compatibility bypasses, or stale baseline assertions remain.

Audit baseline at Phase-X start (parametric / baked / geometryOnly):

| Capture / studio | Logic-lane review | Real browser gate | Known residual |
|---|---:|---:|---|
| Mounts `40a51…` | **10 / 0 / 0** | **10 / 0 / 0** | Keep as no-regression control. |
| Wave T `405fa…` | All six studios reach feature-tier 100%; Mirror transform is **5 / 0 / 0** but retains unresolved whole-studio replacement scope | Partial coverage; Mirror transform currently **3 / 2 / 0** | Real apply/replacement attribution and missing studio coverage. |
| Laptop Stand `5151…` | **12 / 12 / 0** | Not pinned | 7 solid region extrudes, expression chamfer, implicit-target union, two feature patterns, and feature mirror. |
| Part Studio 1 `9841…` | **25 / 16 / 0** | **8 / 33 / 0** | 13 solid region extrudes, checkpoint-backed Sketch 2, closed-hollow shell; one surface extrude excluded. |
| Part Studio 1 `d3cd9…` | **19 / 5 / 0** | Not pinned | 3 solid region extrudes and PART+ADD mirror; one surface extrude excluded. |

- [x] X.1 **Truthful topology-query fallback.** At the exported resolver/provider
      seam, make the unique-prefix body fallback eligible only for exactly one
      slot, one query, body kind, and exact singleton cardinality. Return `null`
      when the rebuilt prefix has zero or multiple live bodies so captured
      rollback query evidence is attempted instead of being masked by a
      degraded fallback. Pin zero/one/many, plural-cardinality, multi-query, and
      captured-evidence precedence in logic-lane tests.


      **Verification (done).** The fallback now requires one body slot, one
      ID-less query, and exact `1..1` cardinality; zero/many live prefix bodies
      return `null` so rollback query evidence can resolve instead. The Wave-T
      fixture now carries captured history evidence for its plural-capable
      transform query instead of relying on single-body inference. Focused
      resolver/translator tests pass (30/30), the complete Onshape import logic
      suite passes (197/197), changed-file lint is clean, and the production
      build is green. Local review counts remain Mounts **10/0/0**, PS1
      **25/16/0**, 5151 **12/12/0**, and d3cd9 **19/5/0**.
- [x] X.2 **Honest solid-extrude boundary.** Inspect `bodyType` before planning a
      solid extrude. Keep `SURFACE` forms baked with a specific reason code and
      review copy; ensure none can enter solid apply, body lineage, or segment
      promotion. Pin the two local `Extrude 4` exclusions without committing
      proprietary bundles.

  **Verification (done).** `SURFACE` now returns
  `extrude-body-type-unsupported` before profile or solid planning, never emits
  `plannedExtrude`, and never enters new-body lineage. A checked-in synthetic
  fixture represents both local surface exclusions; planner and probe-backed
  provider review coverage pin their baked tier, downstream no-lineage behavior,
  and human review copy (focused tests: 47/47; Onshape import suite: 199/199).
  Local plan dumps confirm 9841 and d3cd9 `Extrude 4` stay baked with the new
  reason while 5151 `Extrude 4` remains correctly parametric because it is a
  solid remove. Changed-file lint and the production build are green.
- [ ] X.3 **Refresh local capture evidence.** Target-enrich all five source bundles
      with the current exact-profile evidence schema. Reuse immutable source,
      deterministic-ID, query-resolution, final-geometry, and existing boundary
      evidence when its document microversion and element match; request only
      missing opaque-profile states and proven bake-boundary geometry. Verify format
      v2, the current complete profile-evidence manifest, expected
      `resolvedQueryReferences`, and boundary-only rollback coverage; then refresh the
      curated tracked fixtures without committing the raw source captures. No compatibility
      fallback for pre-X.4 evidence is permitted.


      **Current evidence (target enrichment resumed).** Capture now uses cookie auth,
      browser XSRF bootstrap, bounded rate-limit retries, automatic proven bake
      boundaries, and immutable rollback-indexed FeatureScript evaluation. Deterministic,
      ID-less query, and opaque-profile evidence share one batched request per required
      rollback index; readable `qSketchRegion` queries remain exact local semantics.
      The API budget and endpoint-purpose audit are recorded in
      `docs/onshape-capture-api-budget.md`.

      All five roots now carry complete profile-evidence schema v3 records with no
      unresolved opaque profile and server-certified three-component witnesses for
      every exact sketch region. The `9841` root has also been target-enriched with
      the current versioned deterministic/query immutable-history manifest. The other
      four roots still require that newer all-history enrichment; a second pass over
      every root must make zero API calls. Completion additionally requires proving no
      duplicate history records, preserving immutable raw/final geometry sections,
      and replacing the older broad rollback-snapshot coverage with boundary-only
      coverage only when that cleanup can be proved safe. Root bundles remain
      gitignored and uncommitted. Temporary workspace `74e39f502861d5b417375498`
      has been deleted.
- [ ] X.4 **Exact sketch-region selection.** Replace guessed “all closed regions”

      **2026-07-24 capture attempt.** Targeted enrichment of `405fa226…` was blocked
      before writing output by Onshape `HTTP 402 API limit exceeded` on its first
      immutable FeatureScript evaluation. No root bundle or temporary output changed;
      do not retry the other roots until the API quota recovers. Successful enrichment
      now also prunes legacy rollback snapshots to the currently proven `SURFACE`
      extrude boundaries while preserving `null` when boundary capture was unavailable.
      The permanent capture-enrichment logic test pins this cleanup and the zero-request
      current-evidence path; actual local snapshot cleanup remains pending the quota-gated
      successful enrichment.
      behavior with captured, consumer-indexed evidence for the exact Onshape
      profile query. Carry enough sketch/region/entity provenance through
      capture, bundle contracts, planning, prepare, and apply to resolve opaque
      `qCompressed`, mirror-derived, nested, and selected-subset profiles. Never
      use nearest-geometry scoring. Unsupported or ambiguous evidence remains
      `needs-region-resolution`. Acceptance: every non-surface solid extrude in
      the five local bundles plans and applies parametrically; selected-subset
      and mirrored-profile regressions pass through the real sketch solver and
      OCC apply seam.

      **Current implementation (acceptance still open).** Profile evidence is schema
      v3 and complete in all five roots. Opaque `qCompressed` selections are evaluated
      only by Onshape at the exact pre-consumer rollback index; readable
      `qSketchRegion` queries are exact local region sets and are never decoded as
      compressed queries. Exact selected planar faces carry an interior witness found
      from an adaptive face-parameter grid and certified by `qContainsPoint`; failure
      remains unresolved rather than falling back to bbox centroids, nearest geometry,
      or all closed regions.

      Local planar subdivision now emits every bounded nested cell with
      immediate-child holes; analytically splits line/line (including
      T-junction), line/arc/circle, and arc/circle intersections; and records
      deterministic coincident-source aliases instead of hiding duplicate shared
      edges. Thin concentric annuli use an analytically interior mid-radius
      selector that is still verified through exact containment—no grid luck,
      nearest-region scoring, or all-region fallback. OCC loop construction reuses
      coincident vertices for bounded segments so wire welding cannot replace the
      source edges retained for extrude history.

      Current logic-lane review counts are: Wave T first studio `405` **2/0/0**,
      Mounts `40a51` **10/0/0**, Laptop Stand `5151` **23/1/0**, PS1 `9841`
      **34/7/0**, and `d3cd9` **23/1/0**. In PS1, `Extrude 5`, `6`, `16`, and
      `15` move from `needs-region-resolution` to parametric in source order;
      `Extrude 2`'s ten captured witnesses also each select one exact local cell
      and its remaining degradation is `topology-reference-no-match`, not profile
      resolution. No supported solid feature in the five review plans now reports
      `needs-region-resolution`; the two `SURFACE` Extrude 4 exclusions remain
      honest.

      Proprietary-free logic coverage proves a synthetic schema-v3 selected
      subset and six sparse mirrored annuli through provider review/prepare, the
      real sketch solver, deferred `regionOf` materialization, and real OCC apply.
      That fixture proves the contract pipeline, not Onshape server semantics;
      the ignored roots remain the capture-backed evidence. X.4 stays open until
      those roots pass the real browser gate with no supported solid extrude bake.

      Validation: changed-file lint, production build, focused region/resolver/OCC
      specs, and the provider-to-real-OCC acceptance case are green. `bun run
      test:all` currently stops in logic on three ignored-root assertions: stale
      Wave-T `6/0/0` scope evidence, stale PS1 `7/34/0` tier counts, and a missing
      broad rollback delta. These are X.3 capture-refresh/boundary-cleanup gates;
      they were not weakened to make this partial X.4 slice appear complete.
- [ ] X.5 **Live face-sketch support after producer recovery.** Once solid
      producers are live, promote face-backed sketches through durable
      `SketchPlaneSupportRef` wiring rather than a detached captured-frame
      construction whenever a live support face exists. Captured-frame planes
      remain an honest checkpoint fallback only. Acceptance: PS1 Sketch 2 and
      all other supported face sketches follow a representative upstream support
      edit and rebuild without a checkpoint body.
- [x] X.6 **Narrow translator residuals.** Preserve authored variable linkage for
      expression-valued chamfer dimensions (including `#Wall*(4/5)`), resolve
      an implicit/default UNION target only from exact singleton prefix lineage,
      and close Wave-T Mirror-transform replacement attribution. Ambiguous
      default targets remain honestly baked.

      **Verification (done).** Chamfer widths now preserve translated authored
      expressions through planning, prepare, and apply (`#Wall*(4/5)` →
      `Wall*(4/5)`) rather than substituting the captured zero. Targetless
      `UNION` resolves each explicit tool first, then accepts exactly one
      remaining live prefix body as the target; zero or multiple remaining
      bodies degrade with no-match or ambiguity diagnostics, never by first-body
      selection. Wave-T Mirror transform's stale `wholeStudioLegacy` attribution
      was importer-side: review promotions were not replanning a legacy v2
      strategy. Snapshot-backed recomputation now replans it to `none` (while
      v1/null-snapshot legacy behavior is unchanged). The refreshed Wave-T local
      plan confirms **5/0/0** with strategy `none`; 5151 review moves
      **12/12/0 → 13/11/0** as Chamfer 2 promotes, while Boolean 1 correctly waits
      for X.4 to expose its unique live target body. Focused tests (70), the
      Onshape import suite (202), and `bun run test:all` (596 logic, 125 UI,
      24 static, 62 Playwright) are green.
- [x] X.7 **Observed pattern and mirror variants.** Support only the captured
      variants needed by the local goal: `FEATURE` linear patterns, feature
      mirror, and `PART + ADD` mirror. Reuse existing executable feature kinds
      or lower to ordered existing operations only when seed, output, target,
      and replacement lineage are exact. Preserve upstream edit dependency; do
      not broaden to curve/face/table/skipped-instance pattern families.

  **Verification (done).** The d3cd9 `PART + ADD` mirror remains the existing
  parametric `mirror` operation: its source and target queries must name the
  same singleton deterministic body, its `RightplaneOp` maps explicitly, and
  OCC joins while retaining target-body identity.

  The three 5151 forms now map to the durable `featureReplay` contract, not the
  copy-only body pattern/mirror contracts. Linear pattern 1 preserves exact
  source `[FOKYXKU0uqy9EB3_2]`; Linear pattern 2 preserves
  `[F2B5cy3xMm2MHNU_2]`; Mirror 1 preserves ordered sources
  `[FOKYXKU0uqy9EB3_2, FNmvaMWuCDIXPZo_2, F2B5cy3xMm2MHNU_2,
  Fvk35GMOaMRxzg8_2]`. Import preparation converts those exact source-feature
  positions to backward durable `featureOf` references. The OCC executor
  supports only the captured linear (`NEW`, finite count/spacing, opposite
  direction, no centered/second/skip form) and construction-plane mirror forms;
  it replays only source extrude ADD/REMOVE deltas at each transform, including
  nested replay, against the source's exact target body. It does not copy whole
  bodies, serialize functions, or use first-body/nearest matching.

  The proprietary-free permanent fixture supplies executable ADD seed extrudes
  for the translator → provider → ordered apply → real-OCC seam. It proves a
  source depth edit rebuilds all six direct/linear/mirrored instances, nested
  pattern/mirror ordering, additive then subtractive replay retains one body
  identity, and a stale source `FeatureId` fails with an exact missing-feature
  diagnostic. The real 5151 plan intentionally still reports the three forms
  `downstream-of-baked` while X.4 leaves Extrude 6/7 region profiles unresolved;
  no local promotion was fabricated. When those source operations become live,
  the same exact replay plans prepare and apply. Curve/face/table sources,
  non-full patterns, active body/face selections, centered/second-direction/
  skipped forms, and non-construction replay references remain unsupported.
- [x] X.8 **Closed-hollow shell without openings.** Implemented the captured PS1
      `isHollow=true`, empty-opening, closed-envelope semantics as the existing
      shell contract's distinct `closedHollow` mode. It preserves the outer
      envelope and produces one valid manifold hollow solid; it is not the
      existing offset-all-faces form.

      **Verification (done).** The local `9841` capture's `Shell 1`
      (`Fi8k4Db3MmHpaIG_1`) has `parts=[JND]`, `entities=[]`,
      `isHollow=true`, `thickness="2.5 mm"`, and `oppositeDirection=false`.
      Its rollback snapshots prove one scoped `JND` solid, unchanged XYZ bbox
      (`x -0.0675000027..0.0524999984`, `y 0.0074999998..0.1321506351`,
      `z 0..0.1888916194` meters), and face count **13 → 26**. The translator
      maps that exact form to `closedHollow`, the singleton `parts` body target,
      2.5 mm, and `direction: inside`; outward closed hollows remain explicitly
      baked as `shell-closed-hollow-direction-unsupported` rather than changing
      the captured outer envelope.

      OCC creates an inward offset cavity then subtracts it from the original
      scoped body. It rejects failed offsets/cuts, invalid or non-manifold
      topology, zero/multiple solids, changed outer bounds, and no material
      removal; it replaces the source body in place and never returns the
      original geometry. Permanent synthetic translator/provider/apply coverage
      plus real-OCC tests pin the exact prepared action, unchanged outer bbox,
      increased cavity faces/reduced volume, singleton retained body identity,
      and a shell-thickness edit rebuild. Local plan-dump review moves PS1 from
      **25 / 16 / 0 → 26 / 15 / 0** (parametric / baked / geometryOnly), with
      Shell 1 parametric and no reason code; the plain **6 / 35 / 0** table is
      unchanged because its independently unresolved upstream extrude remains
      baked. Focused logic tests, the complete Onshape suite (206 tests), and
      `bun run test:all` pass (602 logic, 125 UI, 24 static, 62 Playwright).
- [ ] X.9 **Close runtime/import acceptance gaps and complete the browser matrix.**
  - [ ] X.9.1 **Resolve every extrude topology slot before apply.** `UP_TO_VERTEX`,
        `UP_TO_FACE`, and `UP_TO_PART` already execute in Cadara; this item closes the
        importer lifecycle that currently lets internal `{ kind: "topologySlot" }`
        placeholders reach a validated `CreateFeatureRequest` (observed on 9841
        `Extrude 1` as `firstEndVertex`). Detect unresolved extent and boolean slots,
        resolve them atomically against the exact pre-consumer OCC prefix, and prove
        prepared actions contain only runtime `ImportDeferredTopologyRef`/live
        primitive references. Run whole-plan verification only after topology
        resolution reaches a fixed point. Pin all three extent forms at the validated
        browser-worker/OCC boundary; logic-only mock probes are insufficient.

        **Current implementation (acceptance still open).** The import-only extrude
        extent contract now permits kind-correlated `topologyOf` targets only for
        `upToFace` (face), `upToPart` (body), and `upToVertex` (vertex), including
        both two-side ends. Prepared-action validation rejects wrong-kind selectors
        and every planner-only `topologySlot`; the planner boundary also fails closed
        instead of casting an unresolved slot. Apply explicitly rematches all active
        extent targets and forwards only concrete durable references. Focused
        contract/planner/materializer tests, lint, and build are green.

        **Provider lifecycle partial (X.9.1).** The fixed-point now detects live
        one-/two-side extent placeholders and empty explicit boolean scopes rather
        than retained slot declarations; both the initial verification probe and
        each pre-consumer probe suppress unresolved candidates, extent plus scope
        resolve atomically, and every degradation branch restores baked/suppressed.
        prove lifecycle control only, not browser/OCC acceptance. Whole-plan final
        verification remains open and must run after topology fixed-point convergence.
        Available local captures do not currently prove all three forms through the
        browser-worker/OCC prefix boundary, so no synthetic or mock result is being
        presented as that acceptance. `test:all` still stops on the three X.3
        ignored-capture assertions recorded under X.4.

        **Item-D root cause for the whole 9841 cascade (still open, precisely
        located).** With X.9.3's diagnostics in place, the entire 9841 studio
        resolves to ONE blocker, not a class of matcher defects. Every one of the
        23 topology consumers in that studio probes against an **empty** prefix
        (zero live signatures of any entity class), because the studio's first
        solid feature — `Extrude 1` — never builds.

        `Extrude 1` uses `UP_TO_VERTEX`, and its captured evidence is exact and
        present (deterministic id `KHoF`, an exact vertex signature at the
        consumer's own history point). It is unresolvable for a structural
        reason, not an evidence or tolerance one: the decoded query is
        `entityType=VERTEX, queryType=SKETCH_ENTITY, sketchEntityId=QXXzcFIdjHpM.top,
        start` — the START VERTEX OF A SKETCH ENTITY in the `Screen Outline`
        sketch. Cadara's `upToVertex` extent contract
        (`contracts/modeling/schema.ts`) accepts only a solid-body vertex
        (`{ kind: "vertex"; bodyId; vertexId }`), and the OCC executor
        correspondingly does `requireBody(...)` then `body.verticesById.get(...)`.
        No live body can ever carry that vertex, and at `Extrude 1` no body
        exists at all.

        **Closed.** The contract extension landed exactly as scoped: a
        sketch-point extent target (`UpToVertexTarget`) threaded through
        `ExtrudeEndCondition`, import actions, prepared-action validation,
        normalization/validation, the deferred materializer, and the OCC extent
        resolver. The OCC resolver reads the referenced sketch's solved (else
        authored) point, maps it to world through the sketch plane frame, and
        terminates the prism on the plane through that point — inside the
        existing `runInRebuildSlot("extent", ...)` slot, so the reference stays
        live across upstream edits. The importer decodes the consumer's own
        `qCompressed` payload exactly rather than inferring; a payload that is
        not a complete `SKETCH_ENTITY` vertex query stays on the honest
        topology-slot path. No nearby body vertex was ever substituted.

        Pinned by `sketch-point-query-reader.spec.ts` (exact decode plus
        rejection of every non-exact form) and by a real-OCC case in
        `apply-pipeline.spec.ts` proving the built solid's height equals the
        terminator point's Z to 1e-6. The browser gate now reports 9841
        `Extrude 1` parametric, and the `walls` upstream edit still rebuilds.
        The 9841 prefix is non-empty for the first time, so the remaining rows
        (Chamfer 1–4, Shell 1, the cascade extrudes, and the X.5 face-backed
        sketches) are now evaluable against real live evidence under X.9.2.

        Local capture extent-form census (for scoping this work): 9841 has 4
        `BLIND`, 3 `THROUGH_ALL`, 3 `UP_TO_NEXT`, 4 `UP_TO_SURFACE`, 1
        `UP_TO_BODY`, 1 `UP_TO_VERTEX`; d3cd9 has only `BLIND`/`THROUGH_ALL`;
        5151 has 6 `BLIND`, 1 `THROUGH_ALL`, 1 `UP_TO_SURFACE`.
  - [ ] X.9.2 **Close residual exact-topology ambiguity.** Resolve, without tolerance
        relaxation or nearest-geometry selection, Laptop Stand 5151 `Boolean 1` and
        the currently diagnostic 9841 residuals `Chamfer 2`, `Extrude 12`, and
        `Extrude 10`. Use consumer-time signatures, exact ownership/adjacency, and
        source-ordered live prefix lineage. Re-run after each preceding region or
        face-sketch producer promotes so cascade failures are not mistaken for four
        independent matcher defects. Preserve zero/one/many honesty and never
        fabricate `owningFeatureId`.

        **Item-D progress (partially closed).** Two of the four residuals were not
        matcher defects at all. `topology-signatures` derived every body/face
        extent from **tessellated** mesh vertices, so any curved silhouette
        under-reported by the chord sagitta (a 12 mm cylinder measured
        11.9125 mm) and no-matched exact Onshape evidence at any honest
        tolerance. Face and body extents now union the **exact** analytic edge
        boxes, and circular edges report only their swept arc extent (endpoints
        plus interior phase peaks) rather than the full circle. No tolerance was
        relaxed and no nearest-geometry scoring was added.

        **Item-D follow-up (now the 9841 blocker).** With the X.9.1
        `UP_TO_VERTEX` contract gap closed and `Extrude 1` live, 9841's cascade
        resolves to `Chamfer 1` (`topology-reference-no-match`), whose captured
        evidence is an exact `SWEPT_EDGE`-derived line edge
        (`origin [-0.0675, ~0, ~0]`, `direction [1,0,0]`, length 120 mm) over
        the now-live `Extrude 1` body. `Chamfer 2/3/4`, `Boolean 1`, and
        `Delete part 1` share that reason code and are cascade, not independent
        defects. `Shell 1` remains `topology-apply-rematch-failed` on its
        `parts` body scope.

        The three synthetic fixtures that encoded the old chordal numbers
        (`shellSnapshotBody`, `makeRealOccHoleReviewBundle`, the circular-pattern
        seed, and two stub probe signatures) were corrected to the exact analytic
        envelope, because the chord-deficient stand-ins were themselves the
        artifact. 5151 `Boolean 1` remains open (see the tier table below); the
        9841 residuals are blocked behind the `UP_TO_VERTEX` gap recorded in
        X.9.1.
  - [ ] X.9.3 **Make probe and large-bundle failures observable and stable.** Preserve
        the first failed kernel-probe diagnostic instead of collapsing every failed
        prefix to `topology-history-evidence-missing`. The shared Playwright import
        helper must distinguish a visible review error from a timeout and reliably
        load/review/commit the 227 MB `9841` bundle without ad hoc harnesses or stale
        Typia/HMR compatibility bypasses. Diagnose performance or worker composition;
        do not merely inflate every unrelated wait.

        **Diagnostic preservation (done).** `FeaturePlan.reasonDetail` now carries
        the FIRST specific kernel-probe failure recorded for a feature and is never
        overwritten by a later, more generic degradation. Both collapse points are
        covered: the failed pre-consumer prefix probe (previously flattened to a
        bare `topology-history-evidence-missing`) and the final build-containment
        pass (`feature-kernel-build-failed`). Review copy renders it in brackets
        after the reason text. It is purely diagnostic and never participates in
        tier selection, matching, or evidence.

        This was the debugging flywheel the item promised, and it paid out twice on
        its first use against 5151:

        1. It named `Offset distance collapses the circle radius` on `Sketch 5`.
           Root cause: the sketch translator reported an OFFSET circle/arc distance
           as the raw radius delta, but the offset contract measures to the LEFT of
           traversal, so a counter-clockwise circle SHRINKS under a positive
           distance. Every authored outward circle offset therefore collapsed the
           circle at solve time. Fixed by matching the contract's sign convention.
        2. It then named `Dimension ... references a missing line`. Root cause: the
           translator emitted `lineDistance` / `linePointDistance` for ANY
           entity operand, including Onshape's radial-gap DISTANCE between circles
           (and between a point and a circle). Those solver dimension kinds accept
           only line segments, so the whole sketch failed. Cadara has no equivalent
           radial-gap dimension, so those records now drop honestly with a specific
           diagnostic instead of being forged into a dimension the solver rejects.

        Together those promoted 5151 `Sketch 5` and moved every downstream 5151
        bake off the generic evidence-missing code onto its real reason. The
        browser now also surfaces `Extrude 4 boolean target is incorrect` as the
        single named cause behind eight further 5151 bakes.

        Still open under this item: the shared Playwright helper's
        review-error-versus-timeout distinction and the `9841` load/commit
        reliability work were not part of this pass.

        Pinned by a logic-lane spec at the provider/probe seam
        (`apply-pipeline.spec.ts`, "preserves the kernel's first specific
        diagnostic (X.9.3)") and asserted in the browser by the Laptop Stand
        Playwright gate.
  - [ ] X.9.4 **Complete the real-browser acceptance matrix.** Extend the shared
        Playwright Onshape harness, not ad hoc scripts, to cover every studio in all
        five tracked fixture bundles. Assert the exact non-surface feature timeline, zero
        baked/checkpoint actions, zero suppressed supported features, zero
        invalid-reference diagnostics, and at least one meaningful upstream
        edit/rebuild per studio.
- [ ] X.10 **Final verification and cleanup.** Run `bun run test:all`, record exact
      final tier tables here, remove temporary capture/debug code and stale
      mock/browser baselines, and verify `jj status` contains only intentional
      committed work. Phase X is complete only when X.1–X.9.4 and the full suite
      are green; no scoped-complete wording may hide residual supported bakes.

### Item-D verification: real-browser tier tables (Playwright gate)

All numbers below are the REAL browser/worker/OCC gate
(`e2e/onshape-import-parametric.spec.ts`, `e2e/onshape-variable-rebuild.spec.ts`),
not mock review. 14/14 Onshape browser tests pass on a clean Vite server at
`127.0.0.1:3123`.

| Studio | Before item D | After item D | Change |
|---|---:|---:|---|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** | Regression control, unchanged and fully parametric. |
| Wave-T Part Studio 1 | 2 / 0 / 0 | **2 / 0 / 0** | Full-revolve control, unchanged. |
| Wave-T Revolve remove | 4 / 0 / 0 | **4 / 0 / 0** | Unchanged. |
| Wave-T Sweep | 3 / 0 / 0 | **3 / 0 / 0** | Unchanged. |
| Wave-T Loft | 4 / 0 / 0 | **4 / 0 / 0** | Unchanged. |
| Wave-T Extrude extents | 6 / 0 / 0 | **6 / 0 / 0** | Unchanged. |
| Wave-T **Mirror transform** | 5 / 0 / 0 | **5 / 0 / 0** | Fully parametric; the earlier 3 / 2 / 0 browser gap stays closed. |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** | Count unchanged; `Extrude 6` / `7` now name the intrinsic start-extent reason. |
| Part Studio 1 `9841…` | 8 / 33 / 0 | **10 / 31 / 0** | `Extrude 1` and `Chamfer 1` promote from the start-extent contract. |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** | Count unchanged; `Extrude 8` names the intrinsic start-extent reason. |

Wave-T is all-parametric in every covered studio, including Mirror transform at
**5 / 0 / 0**. Mounts remains the full-parametric no-regression control. 9841 is
now the meaningful item-D closure: `Extrude 1` builds the Onshape ground-truth
120 mm body span (`x ∈ [-67.5,+52.5] mm`) because its authored
`startOffsetBound=ENTITY` sketch point is threaded as an exact
`sketchPointOffset` start extent, and `Chamfer 1` then matches the live 120 mm
edge. The BLIND start-offset forms in 9841 `Extrude 10` / `11` remain baked with
`extrude-start-extent-unsupported`; there is no capture-grounded sign convention
to implement without guessing.

#### Remaining baked features and their honest status

**Laptop Stand `5151…` (13 baked).** All eight rows carrying
`Extrude 4 boolean target is incorrect` share ONE root cause and will be
re-evaluated together once it is fixed:

| Feature | Reason code | Classification |
|---|---|---|
| `Fillet 2` | `topology-reference-no-match` | Needs follow-up (X.9.2 exact topology). |
| `Chamfer 1` | `topology-apply-rematch-failed` | Needs follow-up (X.9.2 apply-time rematch). |
| `Extrude 4` | `feature-kernel-build-failed` | Needs follow-up root blocker; the live kernel rejects its boolean target and X.9.3 preserves that diagnostic. |
| `Chamfer 2` | `topology-apply-rematch-failed` | Needs follow-up after the `Extrude 4` root blocker is fixed. |
| `Extrude 6` / `7` | `extrude-start-extent-unsupported` | Honestly unresolvable for now: authored `startOffsetBound=ENTITY` start plane is intrinsic and no solid can be promoted short of it. |
| `Linear pattern 1` / `2`, `Mirror 1` | `downstream-of-baked` | Cascade behind the baked producers. |
| `Boolean 1` | `topology-history-evidence-missing` | Needs follow-up (X.9.2), currently downstream of the `Extrude 4` root blocker. |
| `Chamfer 3` | `topology-reference-no-match` | Needs follow-up (X.9.2 exact topology). |
| `Extrude 8` / `3` | `extrude-extent-topology-unresolved` | Needs follow-up after the upstream topology/body blockers; each quotes the preserved root diagnostic. |

**Part Studio 1 `9841…` (31 baked).** X.9.1 is CLOSED: the extrude contract now
supports both the sketch-point `UP_TO_VERTEX` terminator and the sketch-point
`startOffsetBound=ENTITY` start extent used by `Extrude 1`. X.9.2 is partially
closed for this studio: `Chamfer 1` is parametric, proving the previous no-match
was wrong-body fallout rather than matcher ambiguity. The residuals are now
honest per-feature bakes, and review applies the same refusal rule as commit-time
apply so `Chamfer 2` cannot abort the studio.

| Feature(s) | Reason code | Classification |
|---|---|---|
| `Chamfer 2` | `topology-apply-rematch-failed` with diagnostic `occ-topology-unsupported-history` | Honestly contained kernel-history refusal. Needs follow-up only if cadara later proves conservative post-chamfer edge history. |
| `Chamfer 3`, `Chamfer 4` | `downstream-of-baked` / topology diagnostics from `Chamfer 2` | Cascade behind `Chamfer 2`; not independent matcher defects. |
| `Shell 1` | `topology-apply-rematch-failed` | Needs follow-up (X.9.2); its `parts` body scope still fails apply-time rematch. |
| `Extrude 10`, `Extrude 11` | `extrude-start-extent-unsupported` | Honestly unresolvable BLIND start offsets; no ground truth for the sign convention, so they stay baked. **Superseded** — the sign is now pinned from rollback ground truth; both are excluded-scope cascade (`extrude-extent-topology-unresolved`). |
| `Extrude 2`, `5`, `6`, `7`, `8`, `9`, `12`, `13`, `14`, `15`, `16` | `extrude-extent-topology-unresolved` / `downstream-of-baked` as applicable | Cascade behind the chamfer/shell and face-sketch blockers, not independent contract gaps. |
| `Extrude 3` | `downstream-of-baked` | Pure cascade. |
| `Boolean 1`, `Delete part 1` | `downstream-of-baked` / topology diagnostics | Cascade behind the same contained blockers. |
| `Extrude 4` | `extrude-body-type-unsupported` | **Excluded scope / permanently baked** (SURFACE, not a solid extrude). |
| `Split 1` | split/topology reason-code level, baked suppressed | **Excluded scope** (split-face dependent); pinned at reason-code level and no longer allowed to abort the studio. |
| `Sketch 3`, `Sketch 4` | `needs-history-probe` / topology diagnostics | **Excluded scope** until split/face-backed evidence is in scope. |
| `Sketch 2`, `Cutter`, `Sketch 5`–`Sketch 10` | `needs-history-probe` | X.5 face-backed sketches; evaluable only once their producer bodies are live at the relevant history points. |

The ≥ 30 target is now reached honestly: the browser number is **10 / 31 / 0**,
not a mock-review-only promotion. No tolerance was relaxed, no nearest geometry
was selected, and no identity was fabricated.

**Part Studio 1 `d3cd9…` (8 baked).**

| Feature | Reason code | Classification |
|---|---|---|
| `Extrude 4` | `extrude-body-type-unsupported` | **Excluded scope / permanently baked** (SURFACE). |
| `Split 1` | split/topology kernel diagnostic (`not a closed two-manifold shell`) | **Excluded scope** (split-face dependent). |
| `Sketch 7`, `Sketch 8` | `needs-history-probe` | **Excluded scope** face/split-backed sketches. |
| `Extrude 5`, `Extrude 6`, `Extrude 7` | `downstream-of-baked` | Cascade behind excluded split/face-backed geometry. |
| `Extrude 8` | `extrude-start-extent-unsupported` | Honestly unresolvable start offset; named before the split-dependent cascade. |

**Upstream-edit survival.** Every promotion was proven against a representative
browser edit: Mounts (`nail` variable plus an `Extrude 1` depth edit plus a
constrained sketch drag), Wave-T Revolve remove (angle edit), Wave-T Sweep
(sketch path drag), 5151 (`Wall` variable), 9841 (`walls` variable), and d3cd9
(`screwHole` variable).

**Phase-X verdicts after item D.** X.9.1 is closed. X.9.2 is partially closed:
9841 `Chamfer 1` and the Wave-T Mirror transform curved-extent class are closed,
while 5151 exact topology/apply rematches and 9841 `Shell 1` remain follow-up.
X.5 remains open for face-/split-backed sketches. X.9.3 is closed for diagnostic
preservation and fail-closed single-feature containment; the helper reliability
work is now covered by the 14/14 browser gate.

Session notes for the next orchestrator: subagent model routing —
`dzerv-art/gpt-5.6-sol` had a multi-day quota cooldown (check before use),
`openai-codex/gpt-5.6-sol` quota was reset 2026-07-18, Claude models work as
fallback; always pass fully-qualified model names to workflow agents (fuzzy
resolution picked a keyless openrouter provider once). Curated real bundles are tracked in
`test/fixtures/onshape-captures`; raw recaptures and the root `.cadara` file remain ignored. jj commits with
`--config signing.behavior=drop` while the 1Password SSH agent is down.

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
- Never commit arbitrary raw `*.onshape-capture.json` files outside the curated
  `test/fixtures/onshape-captures` exception or print `.envrc` contents. API creds come from the environment (`direnv` or
  `source .envrc`; the "command not found" noise from sourcing is expected).

## Reference: current translator behavior (2026-07-18)

| featureType | parametric when | otherwise |
|---|---|---|
| assignVariable | always | — |
| newSketch | canonical datum plane, translated cPlane frame, or uniquely probed durable face | `needs-history-probe` / topology match diagnostics |
| defaultPlane/cPlane | provider promotion from captured frame when a dependent sketch needs it | `needs-history-probe` |
| extrude | 1 sketch, parametric+solved, BLIND/SYMMETRIC/THROUGH_ALL, resolvable regions, NEW or single-upstream-body boolean | `needs-region-resolution`, `unsupported-feature` (UP_TO_*), `needs-history-probe` (explicit scope / multi-body) |
| revolve | same-sketch line axis, SOLID, NEW, FULL/one-direction | `revolve-axis-unresolved` (collapsed catch-all) |
| sweep / loft | supported simple forms with resolvable parametric sketch inputs | specific path/profile/guide/condition/periodicity reason codes |
| thicken | NEW, one selected face, one-side positive/negative thickness after exact-prefix face resolution | `thicken-requires-topology` |
| booleanBodies / deleteBodies / splitPart / transform / mirror | body-only topology candidates; promote via exact-prefix probe when all consumed bodies live in parametric prefix | `topology-upstream-baked`, param-specific codes |
| fillet / chamfer / shell / hole | translate and promote after exact-prefix durable topology resolution; hole executes the supported simple/counterbore/countersink subset | topology match/ambiguity codes or parameter-specific codes |
| linear/circular patterns | supported body-copy subset: Onshape `PART`, `NEW`, resolved seed bodies, one linear direction or circular axis, count/spacing/angle options, no centered/skip/second-direction behavior | `pattern-*` parameter/variant codes; curve/sketch/face/feature/table/skip variants remain unsupported |

## Verification notes / tier counts

(filled in by agents as work lands)

- `9841e486906fa2ce62d74d8e` fresh rollback capture: parametric=6, baked=35, geometryOnly=0 (28 rollback snapshots, 328 resolved references).
- Phase 0.2 Wave-T document: `405fa226bb150016d09afc09`, workspace
  `50891a71850666bcbdb5d75d`,
  <https://cad.onshape.com/documents/405fa226bb150016d09afc09/w/50891a71850666bcbdb5d75d>.
  Captured as the gitignored format-v2 bundle
  `405fa226bb150016d09afc09.onshape-capture.json`; every studio has non-null
  rollback snapshots. Checked-in CI coverage is
  `src/domain/import/onshape/wave-t-capture-fixtures.ts`, using the captured v6
  envelopes (`fullRevolve`, `sheetProfilesArray`, `TRANSLATION_3D`, etc.).
  Plan-dump baselines:
  - `Part Studio 1` (`1011ad3d5713fd25de290062`): sketch + FULL/NEW revolve;
    parametric=1, baked=1, geometryOnly=0.
  - `Revolve remove` (`337de0799b893f67db1e2aac`): base sketch/extrude +
    ONE_DIRECTION BLIND/REMOVE revolve; parametric=3, baked=1, geometryOnly=0.
  - `Sweep` (`7a2c487fe0f0acdee662e999`): orthogonal profile/path sketches +
    SOLID/NEW sweep; parametric=2, baked=1, geometryOnly=0.
  - `Loft` (`fb6fcec023da33168eb1aab9`): profile + offset cPlane + profile +
    SOLID/NEW loft without guides; parametric=1, baked=3, geometryOnly=0.
  - `Extrude extents` (`6869c89206c7a4bb97bd9129`): base extrude + two-side
    extrude + UP_TO_NEXT/REMOVE extrude; parametric=5, baked=1, geometryOnly=0.
  - `Mirror transform` (`5ce54329c7479e330d9d5c15`): base extrude + offset
    cPlane + PART mirror + XYZ translation (`makeCopy=false`); parametric=2,
    baked=3, geometryOnly=0.
  Skipped/not authored: UP_TO_FACE (UP_TO_NEXT covers the requested alternative),
  standalone `booleanBodies`, and optional thicken/shell/hole coverage. These
  remain gated and were deferred after completing the six short core studios.
- T.1 extrude verification (`6869c89206c7a4bb97bd9129`): before
  **5 parametric / 1 baked / 0 geometryOnly** (the `UP_TO_NEXT` remove baked
  with `needs-region-resolution`); after **6 / 0 / 0**. The two-side extrude
  retains distinct 20 mm / 10 mm ends, and the remove extrude retains
  `upToNext` plus rollback-identified target-body lineage. `UP_TO_FACE`,
  `UP_TO_PART`, generalized `UP_TO_VERTEX`, and explicit multi-body scope use
  translator-declared exact-prefix topology slots; ambiguous default scope now
  reports `extrude-default-scope-ambiguous`. Pinned captures remain Mounts
  **6 / 4 / 0** and Part Studio 1 **6 / 35 / 0**.
- T.6 chamfer audit (superseded by W.4): at T.6 time Cadara's authoring
  descriptor validated one positive `distance`, and the OCC executor only used
  the equal-leg `Add_3(distance, distance, edge, face)` path (the native
  transaction also accepted one distance). W.4 extends the contract and
  executor to express Onshape `FACE_OFFSET` + `TWO_OFFSETS` and
  `OFFSET_ANGLE`; the T.6 limitation remains historical context only.

  | Capture / studio | Before | After | Chamfer review reasons after |
  |---|---:|---:|---|
  | Mounts (`865452a3e2270f0ebca3ce63`) | 6 / 4 / 0 | 6 / 4 / 0 | Chamfer 1: `topology-durable-naming-unavailable` |
  | Part Studio 1 (`a294dd6e940aa00fdcb206dc`) | 6 / 35 / 0 | 6 / 35 / 0 | Chamfer 1, 2, 4: `topology-durable-naming-unavailable`; Chamfer 3: `chamfer-style-unsupported` |

  Counts are parametric / baked / geometryOnly. The mandatory Wave-T capture
  `405fa226bb150016d09afc09` contains no chamfer feature, so it has no relevant
  T.6 studio; all six studios were nevertheless plan-dumped after the change
  to check for collateral planning changes.
- T.3 sweep verification (`7a2c487fe0f0acdee662e999`): before
  **2 parametric / 1 baked / 0 geometryOnly** (`Solid sweep`:
  `sweep-path-unresolved`); after **3 / 0 / 0**. The profile is deferred through
  `regionOf`, and the single solved circle path in the second parametric sketch
  is deferred through `sketchIdOf` plus its translated entity id. Synthetic
  coverage keeps a multi-curve path baked and verifies provider preparation and
  apply-time path materialization. Pinned captures remain Mounts **6 / 4 / 0**
  and Part Studio 1 **6 / 35 / 0**.
- T.7 shell audit superseded by W.5: Cadara now expresses Onshape's
  non-hollow empty-selection offset-all-faces form via `mode: "offsetAllFaces"`,
  zero `faceTargets`, positive authored thickness, source `bodyTarget`, and
  direction-derived offset sign. The OCC executor uses
  `BRepOffsetAPI_MakeOffsetShape.PerformByJoin(shape, signedOffset, tolerance,
  BRepOffset_Skin, false, false, GeomAbs_Arc, false, progress)`, validates
  `IsDone`, `BRepCheck_Analyzer`, and exactly one solid output, then replaces the
  source body in place with unsupported producer topology history because exact
  topology successor mapping is not proven.

  The real Part Studio 1 envelope is still `isHollow=true`, `entities=[]`, with
  identical before/after bbox and face count 13→26, so Shell 1 remains correctly
  baked as `shell-hollow-without-openings`; it is a closed-hollow/no-openings
  semantic, not the non-hollow whole-solid offset W.5 implemented.

  | Capture / studio | Before | After | Shell review reason after |
  |---|---:|---:|---|
  | Part Studio 1 (`a294dd6e940aa00fdcb206dc`) | 6 / 35 / 0 | 6 / 35 / 0 | Shell 1: `shell-hollow-without-openings` |
  | Mounts (`865452a3e2270f0ebca3ce63`) | 6 / 4 / 0 | 6 / 4 / 0 | No shell feature |

  Counts are parametric / baked / geometryOnly. The Wave-T capture
  `405fa226bb150016d09afc09` contains no shell studio; all six studios were
  plan-dumped after the audit and showed no shell-related collateral change.
- T.4 loft verification (`fb6fcec023da33168eb1aab9`): the mandatory plain
  planner table remains **1 parametric / 3 baked / 0 geometryOnly** before and
  after because captured-frame cPlane promotion is intentionally a provider
  review capability. The logic-lane provider review changes from **1 / 3 / 0**
  to **4 / 0 / 0**:

  | Feature | Before | After |
  |---|---|---|
  | Loft profile A | parametric — `sketch-on-canonical-plane` | same |
  | Loft offset plane | baked — `translator-unavailable` | parametric — `plane-from-captured-frame` |
  | Loft profile B | baked — `topology-durable-naming-unavailable` | parametric — `sketch-on-translated-plane` |
  | Solid loft | baked — `loft-profile-unresolved` | parametric — no reason |

  The loft preserves ordered `sheetProfilesArray`/`wireProfilesArray` entries as
  one deferred `regionOf` target per parametric sketch. Guide curves, non-default
  end conditions, and periodic lofts now report `loft-guides-unsupported`,
  `loft-conditions-unsupported`, and `loft-periodicity-unsupported`. Pinned
  captures remain Mounts **6 / 4 / 0** and Part Studio 1 **6 / 35 / 0**.

- T.2 revolve verification: deferred revolve parameters now share
  `ImportDeferredFeatureBooleanScope` with extrude, validation blesses and checks
  `bodyOf` at the common boolean-scope position for both feature kinds, and the
  orchestrator materializes that scope before returning either request. Checked-in
  Wave-A/Wave-T logic coverage proves ADD/REMOVE/INTERSECT lineage, remote-sketch
  axes, symmetric/two-side extents, prepared-action validation, and apply-time body
  materialization.

  | Capture / studio | Before | After | Revolve result after |
  |---|---:|---:|---|
  | Revolve remove (`337de0799b893f67db1e2aac`) | 3 / 1 / 0 | 4 / 0 / 0 | `Blind remove on extrude`: parametric |
  | FULL revolve (`1011ad3d5713fd25de290062`) | 1 / 1 / 0 | 2 / 0 / 0 | `Full revolve`: parametric |

  Counts are parametric / baked / geometryOnly. The mandatory remove-revolve
  plan dump now has no studio bake. Pinned real captures remain Mounts **6 / 4 / 0**
  and Part Studio 1 **6 / 35 / 0**.

- T.5 translated-cPlane verification: advanced-solid participant targets now
  accept `constructionOf`; the blessed-position validator enforces an earlier
  `createFeature` producer, and `ImportDeferredMaterializer` resolves the recorded
  plane-feature construction to a durable `{ kind: "construction", constructionId }`
  target. Mirror planes and transform distance references recognize cPlane
  `planeOp` queries as `constructionFromFeature` planning refs; provider prepare
  rewrites them to ordered `constructionOf` participants. Rotation and copy remain
  out of scope.

  | Evidence / studio | Before | After | Detail |
  |---|---:|---:|---|
  | Plain plan dump, Mirror transform (`5ce54329c7479e330d9d5c15`) | 2 / 3 / 0 | 2 / 3 / 0 | Static planning has no captured-frame activation; cPlane, mirror, and transform report `needs-history-probe`. |
  | CLI `--review` mock kernel | 2 / 3 / 0 | 3 / 2 / 0 | cPlane promotes with `plane-from-captured-frame`; mirror and XYZ transform remain `topology-reference-no-match` because the generic mock probe emits no matching live body signatures. |
  | CI-safe Wave-T provider fixture with matching history-point body evidence | 3 / 2 / 0 | 4 / 1 / 0 | `Part mirror` promotes parametric and prepare emits its plane participant as `constructionOf`; the remaining baked feature is the fixture's separate XYZ transform, not the distance-reference form. |

  The translated-plane path is therefore proved at the provider review/prepare
  seam rather than by the CLI mock review. Separate translator logic coverage
  proves `TRANSLATION_BY_DISTANCE` uses the same deferred construction participant.
  Pinned real captures remain Mounts **6 / 4 / 0** and Part Studio 1 **6 / 35 / 0**.

- B.2.1 rollback body-delta verification: the logic-lane rollback reader spec
  covers exact body-shape persistence, introduction, change, disappearance,
  unchanged features, sparse snapshot lookup, and missing-boundary refusal using
  synthetic Wave-B fixtures plus both available real rollback bundles. Focused
  Vitest (7 tests), targeted ESLint, and the production build are green. Plan
  dumps remain pinned at Mounts **6 / 4 / 0** and Part Studio 1 **6 / 35 / 0**.
  E2E was skipped because Playwright Chromium is unavailable in this environment.
- K.2.1 feature-stage state verification: internal stages now retain changed
  tracked bodies by semantic feature id and body output slot, expose only the
  matching prior feature stage during execution, and omit suppressed current
  stages. Logic coverage verifies rebuild, reorder, and suppression do not
  cross-associate outputs. `bunx vitest run src/domain/modeling/occ/` is green
  (58 passed, 1 expected fail); lint, production build, and all non-E2E suites
  are green. E2E was skipped because Playwright Chromium is unavailable.
- K.2.2 sketch-profile provenance verification: profile construction now reuses
  exact OCC vertices by `SketchPointId`, retains authored line/arc/circle edges
  by `SketchEntityId`, and keys projected edges/endpoints by their authored
  reference plus projected geometry id. Sampled ellipse/profile-text outlines
  are explicitly marked `approximated` instead of receiving semantic edges.
  Logic coverage proves shared rectangle vertices, line/arc/circle/projected
  maps, rectangle-to-triangle deleted source IDs, and approximation diagnostics.
  `bunx vitest run src/domain/modeling/occ/` is green (58 passed, 1 expected
  fail). Pinned import plans are unaffected. E2E was skipped because Playwright
  Chromium is unavailable in this environment.
- B.2.2 segment-planner verification: the pure logic seam collapses consecutive
  baked body changes into one checkpoint, preserves independent producers,
  carries multi-output siblings, closes transitively over prior checkpoints,
  emits deterministic body bindings, and refuses deletion-only or unresolved
  boundaries with exact legacy preflight codes. Focused Vitest (13 tests),
  targeted ESLint/TypeScript, and all non-E2E suites are green. Plan dumps remain
  pinned at Mounts **6 / 4 / 0** and Part Studio 1 **6 / 35 / 0**. E2E was
  skipped because Playwright Chromium is unavailable in this environment.
- K.2.3 extrude-history provenance verification: prism builders now project
  authored sketch entity/point sources through `Generated`, source-specific and
  whole-profile `FirstShape`/`LastShape`, with feature/profile/end-role keys and
  available draft/boolean history composition. Rectangle prisms cover all 6
  faces, 12 edges, and 8 vertices; dimension edits retain one semantic successor,
  rectangle-to-triangle edits omit the deleted source, two-side/multi-profile
  keys remain disambiguated, and incomplete draft edge/vertex history is marked
  unsupported. `bunx vitest run src/domain/modeling/occ/` is green (59 passed,
  1 expected fail); targeted ESLint and the production build are green. Pinned
  import plans are unaffected. E2E was skipped because Playwright Chromium is
  unavailable in this environment.
- B.2.3 dependency-reachability verification: translators now emit classified
  sketch/body/query inputs without reading or mutating a global baked-lineage
  set. The logic seam proves independent later branches remain eligible,
  checkpoint-provided body lineage is reachable, and baked sketch/profile inputs
  retain `downstream-of-baked` in legacy planning. Focused Onshape Vitest (132
  tests), lint, production build, TypeScript, and all non-E2E suites are green.
  Plan dumps remain pinned at Mounts **6 / 4 / 0** and Part Studio 1
  **6 / 35 / 0**. E2E was skipped because Playwright Chromium is unavailable.
- B.2.4 StudioBakeStrategy verification: snapshot-enabled fidelity planning now
  selects explicit none/segments/whole-studio-legacy strategies, derives
  `requiresStudioBake` only from the legacy branch, surfaces exact preflight
  diagnostics, and replans reviewer demotions into body-history segments. The
  plan dump prints strategy, checkpoint count, segment spans, body sets, and
  replacement producers. Mounts changes from **6 / 4 / 0** to **8 / 2 / 0**:
  Sketch 2 promotes with its captured fixed frame and Extrude 2 promotes before
  the Transform 1 + Chamfer 1 checkpoint; Transform 1 retains
  `transform-rotation-unsupported`. Part Studio 1 remains **6 / 35 / 0**, now
  with one planned checkpoint and no whole-studio bake. Focused Onshape Vitest
  is green (133 tests), targeted ESLint and the production build are green.
  The umbrella non-E2E run is currently blocked only by 13 concurrent Lane-K OCC
  failures reading missing `referenceState.invalidatedReferencesByKey`; Lane B
  did not edit that subtree. E2E was skipped because Playwright Chromium is
  unavailable in this environment.
- K.2.4 stage-reconciliation verification: matching feature/output stages now
  classify exact semantic source keys as zero, one, many, or unsupported before
  the next feature executes. Only unique one-to-one claims retain old public
  topology IDs; all other current topology receives a fresh stage token, while
  deleted/ambiguous/unsupported old references remain structured invalidations
  even when they were already invalidated by a later authored feature. The OCC
  rebuild/reference seam proves dimension edits preserve the selected fillet
  edge and rectangle-to-triangle edits report `occ-topology-deleted` with an
  `invalidReference` diagnostic; synthetic claims pin many and unsupported
  outcomes. `bunx vitest run src/domain/modeling/occ/` is green (60 passed,
  1 expected capability-gate failure); targeted ESLint, TypeScript, and the
  production build are green. The umbrella non-E2E run reaches 475 passing tests
  but is currently blocked by four concurrent Lane-B importer baseline failures
  (Mounts reports 8/2/0 instead of the pinned 6/4/0, plus one Wave-T loft count);
  Lane K did not edit that read-only subtree or its baselines. Import plans are
  unaffected by K.2.4. E2E was skipped because Playwright Chromium is unavailable
  in this environment.
- K.2.5 fresh-ID resurrection verification: reference-state construction now
  quarantines face/edge/vertex IDs that collide with an already invalidated
  reference unless semantic stage reconciliation explicitly proves the old ID.
  Topology-consuming feature preconditions consult that quarantine before OCC
  execution, including native fillet/chamfer paths. The logic-lane authored
  rebuild seam proves an exact delete/recreate collision stays
  `occ-missing-reference`, rejects a downstream fillet before execution, and
  retains the K.2.4 one-to-one semantic-successor case. `bunx vitest run
  src/domain/modeling/occ/` is green (61 passed, 1 expected capability-gate
  failure); targeted ESLint and TypeScript are green. Import plans are
  unaffected. E2E was skipped because Playwright Chromium is unavailable.
- B.3.1 deterministic checkpoint identity verification: rollback checkpoint
  baking now selects the planner-declared output and carried body IDs, preserves
  rollback snapshot order, and encodes stable `onshape-body:<deterministicId>`
  component keys. Prepared assets retain the full segment provenance span and
  exact replacement ordered positions; missing or duplicate body attribution is
  refused rather than falling back to component ordinal. Focused rollback-bake
  Vitest (4 tests), the full Onshape Vitest glob (135 tests), targeted ESLint,
  the production build, and all non-E2E suites (632 tests, 1 expected fail) are
  green. Plan dumps remain Mounts **8 / 2 / 0** and Part Studio 1 **6 / 35 / 0**.
  E2E was skipped because Playwright Chromium is unavailable in this environment.
- B.3.2 shared body-signature verification: exact-prefix review and apply-time
  rematching now use one live-signature helper. Native bodies retain exact B-rep
  topology when available; render meshes provide body-only bbox/centroid evidence
  otherwise, and checkpoint meshes never synthesize face/edge/vertex signatures.
  Logic coverage resolves one checkpoint body, rejects coincident ambiguity, and
  rejects multi-output `bodyOf`. Focused Vitest (11 tests), the full import-domain
  Vitest glob (151 tests), targeted ESLint, TypeScript, and all non-E2E suites
  (636 tests, 1 expected fail) are green. Plan dumps remain Mounts **8 / 2 / 0**
  and Part Studio 1 **6 / 35 / 0**. `bun run test:all` reached E2E only and failed
  because Playwright Chromium is unavailable in the Nix store; E2E was skipped.
- K.2.6 conservative-producer verification: sketch-backed revolve now projects
  exact profile cap, sketch-entity swept-face, and sketch-point swept-edge roles
  through optional start-angle transforms and boolean history. Dimension-only
  rebuilds preserve one semantic successor. Sweep, loft, thicken, face-backed
  profiles, and disappeared multi-result output slots publish conservative
  stages that invalidate prior subtopology as `occ-topology-unsupported-history`
  instead of accepting fresh enumeration; existing draft coverage retains only
  the roles proved by OCC history. The current TypeScript bindings were
  sufficient, so no native shim or Wasm rebuild was needed. `bunx vitest run
  src/domain/modeling/occ/` is green (61 passed, 1 expected capability-gate
  failure); targeted ESLint and TypeScript are green. Import plans are
  unaffected. E2E was skipped because Playwright Chromium is unavailable.
- K.2.7 durable-naming qualification verification: the OCC authored-rebuild and
  reference-resolution release gate now passes normally with exact semantic
  zero/one/many outcomes, coincident delete/recreate quarantine, conservative
  unsupported-thicken invalidation, dimension edits, and reorder/suppression
  coverage. `supportsDurableTopologyNaming` is now `true`.
  `bunx vitest run src/domain/modeling/occ/topological-naming.spec.ts` is green
  (21 tests), the full OCC glob is green (62 tests, no expected failures), and
  the import-domain glob is green (152 tests). Plain real-bundle plan dumps
  remain Mounts **8 / 2 / 0** and Part Studio 1 **6 / 35 / 0**; mock-kernel
  review remains Mounts **8 / 2 / 0** and changes Part Studio 1 to **9 / 32 / 0**
  because Chamfer 1 and the translated-plane face sketch are now allowed to
  promote when their topology evidence matches. Phase S.1 is unblocked but
  remains a separate unchecked task. E2E was skipped because Playwright
  Chromium is unavailable in the Nix store.
- B.3.3 selective checkpoint-action verification: provider preparation now emits
  one `bakedBody` action at each planned segment boundary, records the checkpoint
  under the boundary feature for later transitive replacement, and resolves only
  the planner-declared prior `createFeature` producers. Logic coverage pins two
  separated runs, complete ordered-action permutation validation, source-boundary
  ordering around a neutral variable, exact provenance spans, and exclusion of an
  independent body producer from each replacement scope. Provider + import-action
  validation Vitest is green (14 tests), the full Onshape glob is green (136 tests),
  TypeScript, targeted ESLint, and all non-E2E suites are green (638 tests). Plan
  dumps remain Mounts **8 / 2 / 0** and Part Studio 1 **6 / 35 / 0**. Provider
  gate assertions were made capability-aware after concurrent K.2.7 enabled
  durable naming. `bun run test:all` reached E2E only and failed because Playwright
  Chromium is unavailable in the Nix store; E2E was skipped.
- B.3.4 body-reference/fallback verification: provider preparation now tracks the
  current deterministic body producer through parametric actions and selective
  checkpoints, emits `bodyOf` only for one-output producers, and emits body
  `topologyOf` selectors for attributed multi-output checkpoint bodies. Extrude
  and revolve boolean scopes accept and apply-rematch those selectors. Topology
  fallbacks now select only the consumer body delta plus action-level sibling
  closure, remain at the consumer's ordered position, and record fallback outputs
  for later actions. Logic coverage pins Boolean/Split target-tool role order,
  selective replacement positions, live body-id materialization, multi-output
  scope rematching, and downstream continuation after fallback. Focused Vitest is
  green (29 tests), provider/validation Vitest is green (14 tests), the full
  import-domain glob is green (155 tests), targeted ESLint, TypeScript, build,
  and all non-E2E suites are green. Plan dumps remain Mounts **8 / 2 / 0** and
  Part Studio 1 **6 / 35 / 0**. `bun run test:all` reached E2E only and failed
  because Playwright Chromium is unavailable in the Nix store; E2E was skipped.
- B.3.5 captured-frame checkpoint verification: segmented planning now accepts a
  uniquely captured history-point planar frame after a baked body barrier. Provider
  preparation emits a visible explicit-frame plane immediately after the checkpoint,
  commits the sketch through backward-only `constructionOf`, and continues with its
  parametric extrude without emitting a checkpoint face reference. Missing,
  non-planar, or non-unique frame evidence stays baked. Focused provider/apply
  Vitest is green (36 tests), the full import-domain glob is green (155 tests), and
  lint, TypeScript, and the production build are green. Mounts remains **8 / 2 / 0**
  with Sketch 2 and Extrude 2 parametric and Transform 1 baked; Part Studio 1 remains
  pinned at **6 / 35 / 0**. `bun run test:all` reached E2E only and failed because
  Playwright Chromium is unavailable in the Nix store; E2E was skipped.
- B.3.6 review-form segment verification: the provider review form now places a
  Bake segments section before per-feature fidelity, with none/segmented/legacy
  strategy copy, checkpoint counts, feature spans, output/consumed/carried body IDs,
  replacement-action counts, downstream continuation, tessellation status, and
  human-readable preflight limitations. Per-feature rows retain intrinsic reason
  copy while naming their segment or satisfied checkpoint dependency. Prepare emits
  planned/tessellation-backed/legacy-fallback diagnostics and extends the fidelity
  summary with strategy and checkpoint count. Focused provider Vitest (14 tests),
  the import/contracts glob (165 tests), TypeScript, targeted ESLint, and all
  non-E2E suites (641 tests) are green. Plain plan dumps remain Mounts **8 / 2 / 0**
  and Part Studio 1 **6 / 35 / 0**. `bun run test:all` reached E2E only and failed
  because Playwright Chromium is unavailable in the Nix store; E2E was skipped.
- B.3.7/B.4 integration verification: a shared Wave-B fixture now applies two
  separated rotation-bake runs through the modeling-service seam, including a
  carried sibling from a multi-output producer, unique checkpoint `topologyOf`
  rematching for Boolean target/tool roles, an intentionally ambiguous second
  checkpoint that activates the same-position MOVE fallback, neutral variables
  before/between/after checkpoints, exact replacement scopes, and legacy-v1 action
  and apply equivalence with and without a history probe. The matrix exposed and
  fixed provisional checkpoint replanning for topology consumers. Focused
  apply-pipeline Vitest is green (24 tests); provider/planner focused Vitest,
  TypeScript, targeted ESLint, and the import/contracts glob are green (167 tests).
  Real-capture rollback-prefix review records Mounts **6 / 4 / 0 → 8 / 2 / 0** and
  Part Studio 1 **6 / 35 / 0 → 14 / 27 / 0**; Split 1, Boolean 1, and Delete part 1
  all promote. `bun run test:all` passed lint, build, and all non-E2E suites, then
  reached E2E and failed only because Playwright Chromium is absent from the Nix
  store; E2E/browser evidence was skipped as required.
- S.1/V.1/V.2 final acceptance (plan-dump portion): every subtopology gate now
  reads the live `OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming` value.
  Fillet/chamfer/shell use the shared exact-prefix resolver; sketch-on-face uses
  the same live capability before unique face promotion. Thicken's former
  unconditional refusal was replaced by a conservative topology candidate for
  `NEW`, exactly one selected face, one-side thickness; it promotes only after a
  unique durable face match. CI-safe provider coverage proves Chamfer promotion
  with history-point edge evidence, and resolver/definition coverage proves
  fillet plus thicken deferred topology materialization. Hole still resolves its
  topology only to degrade with `hole-executor-unavailable`.

  The real-bundle mock review distinction is intentional: Mounts Chamfer 1 stays
  baked as `topology-reference-no-match` because the plan-dump mock does not
  provide a matching live edge signature; Part Studio 1 Chamfer 1 promotes,
  while Chamfers 2 and 4 remain no-match and Chamfer 3 remains
  `chamfer-style-unsupported`. The CI-safe fixture supplies the evidence that the
  Mounts-style mock lacks rather than weakening matching.

  `REVIEW_REASON_COPY` is a typed `Record<PlanReasonCode, string>` and now covers
  the complete planner union, including all Wave-T revolve/loft/extrude reasons
  and Wave-B checkpoint diagnostics. Existing provider review-form coverage also
  asserts that rendered values contain human copy rather than raw reason codes;
  CI-safe provider/planner fixtures retain their per-tier count assertions.

  Final counts are parametric / baked / geometryOnly:

  | Capture / studio | Plain plan | Rollback-prefix `--review` | Acceptance |
  |---|---:|---:|---|
  | Mounts (`40a51fb8fa82fd4565151114`, `865452a3e2270f0ebca3ce63`) | **8 / 2 / 0** | **8 / 2 / 0** | Meets ≥8 target; Transform 1 is out-of-scope rotation and Chamfer 1 is mock-probe no-match. |
  | Part Studio 1 (`9841e486906fa2ce62d74d8e`, `a294dd6e940aa00fdcb206dc`) | **6 / 35 / 0** | **14 / 27 / 0** | Chamfer 1, Screen Outline, Split 1, Boolean 1, Delete part 1, Incline, Extrude 8, and Extrude 13 promote with rollback-prefix evidence. |
  | FULL revolve (`1011ad3d5713fd25de290062`) | **2 / 0 / 0** | **2 / 0 / 0** | Revolve parametric. |
  | Revolve remove (`337de0799b893f67db1e2aac`) | **4 / 0 / 0** | **4 / 0 / 0** | Boolean REMOVE revolve parametric. |
  | Sweep (`7a2c487fe0f0acdee662e999`) | **3 / 0 / 0** | **3 / 0 / 0** | Sweep parametric. |
  | Loft (`fb6fcec023da33168eb1aab9`) | **1 / 3 / 0** | **4 / 0 / 0** | Captured-frame plane, dependent sketch, and loft promote in review. |
  | Extrude extents (`6869c89206c7a4bb97bd9129`) | **6 / 0 / 0** | **6 / 0 / 0** | Two-side and UP_TO_NEXT extrudes parametric. |
  | Mirror transform (`5ce54329c7479e330d9d5c15`) | **2 / 3 / 0** | **5 / 0 / 0** | Captured-frame cPlane, PART mirror, and XYZ translation all promote with rollback-prefix body evidence. |

  Pinned spec baselines follow the seam: the plain snapshot-aware planner remains
  Mounts **8 / 2 / 0** and Part Studio 1 **6 / 35 / 0**; provider/apply tests that
  intentionally omit history capability remain **6 / 4 / 0** and **6 / 35 / 0**.
  The promoted **8 / 2 / 0** and **14 / 27 / 0** rollback-prefix counts are pinned
  at the provider/segmented-review seam rather than incorrectly changing the
  probe-less baselines.

  Browser import verification was not attempted: Playwright Chromium is absent.
  Therefore V.2's browser half and all of V.3/V.4 remain pending on the
  environment fix, with their checkboxes intentionally left unticked.
  (Superseded: see the "V.3/V.4 real-kernel closure" note below — Chromium
  became available in a later session and V.3/V.4 are now complete.)

  Final verification: `bunx vitest run src/domain/import/ src/contracts/import/
  src/domain/modeling/occ/` passed **48 files / 230 tests**. `bun run test:all`
  passed lint, production build, logic (**174 files / 495 tests**), UI (**61 files /
  125 tests**), and static (**14 files / 24 tests**), then failed all 58 E2E cases
  at Chromium launch because the configured executable is absent. No browser test
  reached an assertion, so there were no E2E assertion failures to classify.

- **V.3/V.4 real-kernel closure (this session).** Playwright Chromium is now
  available; `bun run test:e2e` was run against the real gitignored bundles
  (Mounts `40a51fb8fa82fd4565151114`, Part Studio 1 `9841e486906fa2ce62d74d8e`,
  Wave T `405fa226bb150016d09afc09`). Baseline at session start (with a prior
  agent's uncommitted, partial `e2e/helpers/onshape-import.ts` +
  `e2e/onshape-import-parametric.spec.ts` edits already in the tree): 58
  passed / 3 failed (a fourth previously-reported failure, the Part Studio 1
  missing-`feature_extrude-1` case, was already fixed uncommitted by that
  prior agent). All 3 remaining failures were root-caused with direct browser
  evidence (temporary `console.log`/`page.on("console")` instrumentation,
  since removed) and turned out to be **test-authoring defects, not production
  defects**:

  | Test | Symptom | Root cause | Fix |
  |---|---|---|---|
  | Mounts constrained sketch drag | `expectSketchSessionActive()` timed out polling `sketchPlane !== "none"` after entering Sketch 2 | Sketch 2 is committed on a captured-frame **construction** plane, not a canonical XY/YZ/XZ datum. `SketchPlaneDefinition.key` (`src/contracts/shared/sketch-plane.ts`) is `null` for any non-canonical plane by contract, so the debug `sketchPlane` readout is legitimately `"none"` there; the shared harness helper (built for canonical-plane sketches) does not apply. Confirmed via page snapshot: `machineState` was already `sketch/editingSketch/sketch` with Sketch 2's real geometry loaded. | Assert `workbench.expectMachine("editingSketch")` directly instead of `expectSketchSessionActive()` for this sketch, with a comment explaining why. |
  | Mounts variable/extrude edits | Rolling history to `feature_extrude-2` never showed `body_feature_extrude-2` in `selectableTargets` | Extrude 2 is a `REMOVE` boolean that cuts *into* the body Extrude 1 created (`booleanScope` targets Onshape body `JHD`); it does not create a new body. Durable body identity is keyed by the **owning (creating) feature**, not the latest consumer: `trackReplacementSolidBody`/`trackReplacementSolidBodyFromNativePayload` in `src/domain/modeling/occ/topology.ts` explicitly retain `bodyId: input.previous.bodyId` across in-place boolean modification. So the body legitimately stays `body_feature_extrude-1` through Extrude 2, Transform 1, and Chamfer 1, until the bake-segment checkpoint replaces it with `body_feature_bakedBody-1`. Confirmed Extrude 2 does execute correctly: rolling from `feature_extrude-1` to `feature_extrude-2` changes `body_feature_extrude-1`'s face count from 10 to 11 (the through-all cut applying), with the correct captured-frame-local `regionOf` interior point (see below). | Assert `body_feature_extrude-1` persists (not `-extrude-2`) and additionally assert its face count changes across the roll, proving the cut actually applied instead of merely asserting an id that would never exist. |
  | Wave T Sweep timeline | `sketch_2.sketch_point_Sweep_path_0_end` never projected | Cadara's sketch entity id convention is `sketch_point_<sketchFeatureId>_<entityId>_<role>` — the guessed candidate omitted the owning sketch feature id (`FmRzyMZqAsUDXhZ_0`). Confirmed against the real captured bundle's `selectableTargets`. | Use the confirmed id `sketch_2.sketch_point_FmRzyMZqAsUDXhZ_0_Sweep_path_0_end`. |

  **On the prompted "known root cause" (regionOf interior point in canonical vs.
  captured-frame-local coordinates):** this was investigated first, per the
  provided hypothesis, before the above three test-authoring defects were
  found. Direct evidence contradicts the hypothesis for the current code: a
  temporary log at `resolveOnshapeSketchProfiles` (`profile-resolver.ts`)
  during a real Mounts import showed Extrude 2's resolved interior point is
  `[0, 0]` — correctly expressed in Sketch 2's captured-frame-local
  coordinates (the captured frame's `origin: [-4, ~0, 5]` is subtracted before
  the dot-product projection in `projectPointToSketchPlaneFrame`
  (`sketch-translator.ts`) — not the canonical `[-4, 0]` the hypothesis
  described). This is exactly what the existing logic-lane regression
  `profile-resolver.spec.ts` ("profile resolver derives selectors in the
  referenced sketch frame") already pins: a circle whose world-space center
  coincides with the captured frame's origin must resolve to a local interior
  point of `[0, 0]`, not the frame's world offset. That regression already
  existed and already passed before this session's changes, so no new
  logic-lane test or production fix was needed at that seam — the state
  lane/seam this session's investigation targeted (`resolveOnshapeSketchProfiles`
  at the profile-resolution seam, called from `extrude-feature-translator.ts`)
  was already correctly proven. No production code changes were required to
  fix any of the 3 failing tests; only `e2e/onshape-import-parametric.spec.ts`
  assertions changed (plus one unrelated pre-existing lint violation fixed in
  `src/domain/import/orchestrator.ts`, a stray `no-unused-vars` on an
  intentional rest-sibling destructure, blocking `bun run test:all`).

  New V.3 real-interaction coverage added/kept in
  `e2e/onshape-import-parametric.spec.ts` (helper support in
  `e2e/helpers/onshape-import.ts`: `studioName` param + `reviewText` return
  value, both from the prior agent's uncommitted work, kept as-is):
  - Mounts: import review asserts the segmented timeline (`feature_extrude-1`,
    `feature_plane-1` captured-frame construction, `feature_extrude-2`,
    `feature_bakedBody-1` checkpoint) and `8 parametric, 2 baked` tier text;
    pointer-drags a constrained Sketch 2 vertex and asserts the constraint
    holds (`toBeCloseTo`) after commit; rolls to `feature_extrude-1`, edits
    variable `nail`, asserts a real geometry-pixel delta and the checkpoint
    body's continued presence; rolls forward through `feature_extrude-2` and
    proves the boolean cut applied via a face-count delta; rolls to the
    checkpoint and back; edits Extrude 1's depth via a form field and
    verifies the full segmented timeline still commits.
  - Wave T fixture bundle (`405fa226bb150016d09afc09`, via the `studioName`
    param): `Revolve remove` studio — commits, asserts its parametric
    timeline, edits the revolve's driving `Angle (degrees)` parameter through
    a form field, and asserts a geometry-pixel delta; `Sweep` studio —
    commits, asserts its timeline, pointer-drags the Sweep path's sketch
    endpoint and asserts a geometry-pixel delta; `Mirror transform` studio —
    commits and asserts its timeline (parametric extrude/plane, baked
    mirror/transform, per T.5's fixture-level result).
  - Part Studio 1: import review asserts the **real-kernel** tier text and
    per-feature reasons (see table below), edits variable `walls`, and
    asserts a geometry-pixel delta plus the two checkpoint bodies' continued
    presence.

  All tests use the existing `existsSync(...)`-guarded `test.skip` pattern for
  the gitignored real bundles, and reuse existing helpers
  (`meanPixelDelta`, `SketchWorkbenchHarness`, `__cadProjectToScreen`,
  `__cadaraDebug`) rather than new one-off harnesses.

  **Real-kernel tier tables** (this session, via the browser/provider seam,
  contrasted with the mock-kernel/plan-dump numbers already pinned above):

  | Bundle / studio | Mock-kernel or plain-planner reference | Real-kernel (browser, this session) | Notes |
  |---|---:|---:|---|
  | Mounts (`40a51fb8fa82fd4565151114`) | 8 / 2 / 0 (B.2.4/K.2.7) | **8 / 2 / 0** | Matches; Transform 1 + Chamfer 1 share one bake-segment checkpoint (`Chamfer 1 checkpoint`). Sketch 2 and Extrude 2 promote parametrically above it. |
  | Part Studio 1 (`9841e486906fa2ce62d74d8e`) | 9 / 32 / 0 (K.2.7 mock-kernel review) / 14 / 27 / 0 (B.4 rollback-prefix target) | **8 / 33 / 0** | Real kernel does *not* match the mock-kernel/rollback-prefix promotions for `Split 1`, `Boolean 1`, `Delete part 1` (all remain baked-suppressed, reason `topology reference did not match`) or `Extrude 1` (baked here; it was parametric in the old pinned 6/35/0 and 8-parametric browser targets). This is a real-kernel topology/signature-matching gap in the exact-prefix probe against this specific capture, not a regression from this session's changes (no production code changed). It is recorded here as the honest real-kernel outcome, distinct from the mock-kernel/plan-dump figures pinned elsewhere in this file. |
  | Wave T `Revolve remove` | 4 / 0 / 0 (T.2 plan-dump) | **4 / 0 / 0** | Matches; revolve angle edit through the UI produces a verified geometry-pixel delta. |
  | Wave T `Sweep` | 3 / 0 / 0 (T.3 plan-dump) | **3 / 0 / 0** | Matches; sweep path drag produces a verified geometry-pixel delta. |
  | Wave T `Mirror transform` | 2 / 3 / 0 (plain plan-dump, no captured-frame activation) / 4 / 1 / 0 (CI-safe provider fixture, T.5) | **3 / 2 / 0** | Real Wave T capture differs from the synthetic T.5 fixture; browser review promotes the extrude and the captured-frame plane, and keeps 2 features baked (this capture's own mirror/transform forms, not the T.5 fixture's forms). |

  Counts are parametric / baked / geometryOnly. `bun run test:e2e` finished
  **61 passed / 0 failed** (net -1 test versus the 58+4=62 nominal baseline:
  the prior agent's uncommitted edits already added the 3 Wave T timeline
  tests and already fixed the Part Studio 1 case, for a pre-fix total of 61
  tests with 3 failing). `bun run test` (logic + UI + static) is **646/646**
  (174 files / 497 tests logic, 61 files / 125 tests UI, 14 files / 24 tests
  static). `bun run test:all` (lint + build + test + test:e2e) is fully
  green.
- W.1 sketch-on-face promotion verification (this session, plan-dump
  mock-kernel rollback-prefix review, no capture recapture performed):

  | Capture / studio | Before (rollback-prefix review) | After (this session) | Notes |
  |---|---:|---:|---|
  | Part Studio 1 (`9841e486906fa2ce62d74d8e`) | 14 / 27 / 0 | **22 / 19 / 0** | Plain planner unchanged at 6 / 35 / 0. Eight body-face sketches promoted to `sketch-on-probed-face` (Cutter, Sketch 3, 4, 5, 6, 7, 9, 10) via consumer-aware probe selection + iterative fixed-point promotion. |
  | Mounts (`40a51fb8fa82fd4565151114`) | 8 / 2 / 0 | **8 / 2 / 0** | Unchanged (plain and review agree); no body-face sketches eligible above the Chamfer 1 bake checkpoint. |
  | Wave T (`405fa226bb150016d09afc09`) | 2 / 0 / 0 | **2 / 0 / 0** | Unchanged (plain and review agree); no body-face sketch-plane features. |

  Counts are parametric / baked / geometryOnly.

  **(b) Capture-side recapture NOT needed.** Sub-item (b) (resolving sketch-plane
  queries at each sketch's rollback index rather than only unresolved-at-final
  IDs) was resolved by analysis: the existing captured reference evidence
  already carries the per-consumer probe signatures needed to match a sketch's
  prefix body face. Consumer-aware selection in
  `activateProbeBackedPlanning` reads the consumer's own captured record, so no
  new capture pass or `references.ts` change was required.

  **(3) Promotions vs. honest bakes.** Promoted to `sketch-on-probed-face`:
  Cutter, Sketch 3, Sketch 4, Sketch 5, Sketch 6, Sketch 7, Sketch 9, Sketch
  10 (8 body-face sketches). Stayed baked honestly:
  - **Sketch 2** → `sketch-face-on-checkpoint-body` (finalState-only face
    evidence with no historyPoint; the face lives on a checkpoint/baked body,
    so it cannot be lifted onto a live probed face).
  - Sketch 1, Side Outline, Sketch 8 remain canonical-plane sketches;
    Screen Outline stays `sketch-on-translated-plane` (already parametric).

  **(4) Remaining gap toward the ~37/41 target.** The 8 promoted sketches did
  not cascade-unlock all their downstream extrudes: extrudes whose regions are
  built from mirror-derived sketch entities still fail region resolution and
  stay baked with `needs-region-resolution` (`onshape-region-selector-unverified`).
  Concretely the extrudes consuming Sketches 5 / 7 / 10, plus **Extrude 12**
  (empty-diagnostics case: no region candidates surfaced), remain baked. This
  is the primary residual gap between the current 22 parametric and the ~37
  target and is recorded as a **W.1 follow-up** (region selection over
  mirror-derived sketch geometry — needs verified region-selector evidence for
  mirrored profile entities).

  **(5) Apply-path fix surfaced by real-kernel e2e (this session).** The
  fixed-point promotion loop added `|| candidate.tier === "parametric"` to its
  consumer-skip guard. That also skipped a *parametric* extrude whose boolean
  scope is still unresolved: `extrude-planner` seeds `topologyTargets` with an
  empty `targets` array, and the loop is the only place that matches the target
  body against the parametric prefix. The skip left the Mounts `Extrude 2`
  (REMOVE) with an empty boolean scope, so its real-kernel apply failed region
  selection and dropped `Extrude 2` + the bake checkpoint (`bakedBody-1`). The
  mock plan-dump could not see this — the prepared actions are byte-identical to
  the pre-W.1 baseline except for the emptied `booleanScope`, which only the
  real OCC kernel rejects at apply. Fix: skip a parametric candidate only when
  its extrude topology is already resolved (`booleanScope.targets` non-empty),
  which restores the pre-W.1 resolution while keeping the fixed-point from
  re-resolving a settled consumer. All six real-kernel Onshape e2e tests
  (Mounts ×2, Part Studio 1, Wave T ×3) and `bun run test:all` are green.
- **Review-pass containment closure (this session, 4 commits +1 e2e budget).**
  An end-to-end review found and fixed four issues; `bun run test:all` is now
  fully green (648 logic + 125 UI + 24 static + 62 Playwright).
  - **Snapshot prune regression fixed** (`Recapture every Onshape bake
    boundary`): the X.3 boundary cleanup had pruned rollback snapshots down to
    `SURFACE`-extrude boundaries only, starving the bake-segment planner
    (Wave-T Mirror transform silently lost its `bakedBody-1` checkpoint; the
    9841 rollback body-delta pin and Wave-T 6/0/0 pin went red). Retention now
    covers every non-`newSketch` feature (derived from
    `bodyDeltaBetweenFeatures` needing both delta sides), and `--enrich`
    backfills missing required snapshots (one lazy workspace per document,
    one rollback+tessellation(+STEP) per missing boundary, existing snapshots
    never re-captured, zero requests when current). A live backfill restored
    405 (13 snapshots) and 9841 (28 snapshots); all three staleness failures
    from the X.4 note are green with no baseline edits.
  - **X.9.1 feature-level fail-close** (`Bake unresolved extrude topology per
    feature`): 9841 `Extrude 1`'s `firstEndVertex` slot reached prepare
    unresolved and the whole-studio throw aborted the PS1 import. The provider
    now degrades any parametric extrude with a live topology slot to baked with
    new reason `extrude-extent-topology-unresolved` at every boundary
    (verification probe, per-candidate and sketch-consumer prefixes,
    post-fixed-point sweep, prepare fallback); `resolvedExtrudeExtent`'s throw
    remains as an unreachable invariant.
  - **Apply-time rematch containment** (`Bake features that fail apply-time
    rematch`): PS1 Shell 1's `parts`/`JND` body scope matched
    tessellation-backed review signatures but failed live-OCC rematch at apply
    (`TopologyApplyRematchError`), aborting the import. `reviewStudio` now
    retries activation with the offending feature pinned baked
    (`topology-apply-rematch-failed`), dependents cascade, repeated failure
    rethrows, non-topology errors still propagate. PS1 browser review now opens
    and commits at **9 / 32 / 0**.
  - **Durable side-edge lineage regression fixed** (`Fix side-edge lineage for
    full sketch segments`): `3d3fb213`'s bounded-segment path fired for full
    authored segments (region extraction populates start/end positions for
    every segment), bypassing `provenance.vertices` and leaving extrude side
    edges without lineage — durable edge ids degraded to fresh `t0002_N` on any
    rebuild, breaking 6 e2e (fillet/chamfer/revolve/sweep/feature-chain +
    face-backed sketch reopen). A `isTrimmedEntitySegment` guard routes only
    genuinely trimmed segments through the bounded path. One legitimate
    deterministic Mounts region-id pin updated; the 9841 `walls` e2e got a
    360 s budget for the 237 MB double-probe review.
  - **API-budget review outcome:** enrichment remains one batched FeatureScript
    request per required rollback index with zero-request second passes (405
    and 9841 verified live: "evidence is current; no FeatureScript request").
    Per user decision, no on-disk evidence cache — captures are one-shot.
  - **Honest residual:** Wave-T Mirror transform plan-dump review is now
    **2 / 3 / 0** with `wholeStudioLegacy` (restored snapshots expose the mock
    probe's missing live body signatures honestly instead of `none`/silent
    drop); the real browser gate stays 3 / 2 / 0 with its checkpoint and all
    62 e2e pass.

### Item-D continuation: the `startOffset` start-extent root cause

**Root cause of the 9841 `Chamfer 1` no-match — not a matcher defect.** The
X.9.2 framing ("residual exact-topology ambiguity") was wrong for 9841. The
captured evidence is exact, the matcher is correct, and no tolerance or
nearest-geometry change was warranted or made. `Extrude 1` was building the
**wrong solid**, and every downstream consumer then honestly no-matched.

Diagnosed in the real-OCC node harness (never the mock), with the X.9.3
`reasonDetail` flywheel extended to print each live candidate's rejection
reasons plus a live-prefix census:

- `Chamfer 1`'s captured `historyPoint` edge `JNB`: `origin [-67.5, 0, 0]`,
  `direction [1,0,0]`, bbox `[-67.5,0,0] → [+52.5,0,0]` — **length 120 mm**.
- The one live edge agreeing on *both* analytic gates (`direction-angle` and
  `line-support` — i.e. the same infinite line) was `[-67.5,0,0] → [0,0,0]`,
  **length 67.5 mm**, rejected *solely* on `bounding-box-out-of-tolerance`.

`Extrude 1` is `UP_TO_VERTEX` (terminator `KHoF` at x = −67.5) **plus**
`startOffset=true`, `startOffsetBound=ENTITY`, `startOffsetEntity=KHsF` — a
second sketch point at x = **+52.5**. Cadara's contract hard-coded
`startExtent: { kind: "profilePlane" }`, and the importer dropped `startOffset*`
entirely, so the prism started at x = 0 instead of x = +52.5. Live body was
x ∈ [−67.5, 0]; Onshape rollback snapshot 4 ground truth is x ∈
[−67.5, +52.5] mm. The missing 52.5 mm is exactly the dropped start plane.

X.9.1 pinned only the terminator end (`minx`, to 2.7e-6 mm) and never checked
`maxx`, which is why the wrong body looked exact.

**Census of the same form:** 9841 `Extrude 1/3/15/16` and 5151 `Extrude 6/7`
and d3cd9 `Extrude 8` use `startOffsetBound=ENTITY`; 9841 `Extrude 10/11` use
`BLIND` start offsets.

#### Landed: fail-closed demotion plus start-extent contract

The fail-closed demotion and the start-extent contract are now both landed. The
contract extends `ExtrudeFeatureParameters.startExtent` to
`profilePlane | blindOffset | sketchPointOffset`, threaded like X.9.1's
sketch-point up-to-vertex extension through `contracts/modeling/schema.ts`,
import actions (`ImportDeferredExtrudeStartExtent`), prepared-action validation,
the deferred materializer, modeling-service normalization, and the OCC start-plane
resolver. The importer reads `startOffsetBound=ENTITY` through the exact
`qCompressed` sketch-point reader. Malformed payloads throw or bake with a
specific reason; they do not silently fall back to the profile plane.

Verified real-OCC pin (`apply-pipeline.spec.ts`, logic lane): a sketch-point
start offset builds between **both** authored abscissae to 1e-6 — `high[0] =
+52.5`, `low[0] = −67.5`. Before the contract existed the high bound was 0.
Browser verification proves the same through apply/commit: 9841 `Extrude 1` and
`Chamfer 1` both promote, the committed timeline contains those two live
features, and the `walls` variable rebuild survives with zero snapshot
diagnostics.

`BLIND` start offsets stay honestly baked (`extrude-start-extent-unsupported`):
this capture set cannot pin their authored sign convention against ground truth,
and guessing it would displace geometry. That affects 9841 `Extrude 10` /
`Extrude 11`; entity-bound start offsets in 5151 `Extrude 6` / `7` and d3cd9
`Extrude 8` still bake because their other live-prefix blockers fire first or the
same exact start-plane support is not sufficient to make their downstream split /
boolean context build.

The earlier parked red gate is also closed: review now applies the same
commit-time refusal rule, so 9841 `Chamfer 2` is baked with the real
`occ-topology-unsupported-history` diagnostic instead of being promoted and then
aborting the whole studio. A single feature failure is contained; the studio
commits.

Final item-D browser gate on clean port 3123:

| Studio | Final browser gate |
|---|---:|
| Mounts `40a51…` | **10 / 0 / 0** |
| Wave-T all covered studios | **all parametric** (`2/0/0`, `4/0/0`, `3/0/0`, `4/0/0`, `6/0/0`, Mirror transform `5/0/0`) |
| Laptop Stand `5151…` | **11 / 13 / 0** |
| Part Studio 1 `9841…` | **10 / 31 / 0** |
| Part Studio 1 `d3cd9…` | **16 / 8 / 0** |

`bun run test:all` is the final validation gate for the landing commit.

### Item-D follow-ups: the chamfer/fillet lineage root cause (X.9.2)

**Root cause found and fixed: `BRepFilletAPI::IsDeleted` over-reports.** The
X.9.2 framing ("Chamfer 1's conservative stage history invalidates the edges
Chamfer 2 consumes") named the symptom correctly but not the mechanism. It was
not a missing-history gap and not a matcher gap; it was a kernel answer taken too
literally.

Diagnosed in the real OCC kernel (never the mock). For a single chamfer on one
edge of a box, OCC reports, per prior subtopology:

| prior entity | `IsDeleted` | `Modified` | still present as the IDENTICAL `TopoDS` shape |
|---|---|---:|---|
| the chamfered edge | `true` | 0 | no (genuinely consumed) |
| 4 adjacent edges | `false` | 1 | no (genuinely modified) |
| **7 untouched edges** | **`true`** | **0** | **yes** |
| **6 untouched vertices** | **`true`** | **0** | **yes** |

So `IsDeleted` answers `true` for every prior edge/vertex the operation did not
itself modify — including ones the result still contains as the *same* shape.
Cadara believed it, invalidated that untouched topology, and any later feature
selecting one of those edges was refused at `assertTopologyReferenceLive` with
`occ-topology-unsupported-history`. Two facts made this invisible until now:
sequential *apply* survives it (the invalidation is only consulted on replay),
and only the **rebuild** path — which is what apply and the probe actually run
once a later feature exists — fails.

**The fix is exact identity, never a match.** Fillet and chamfer now publish
stage lineage (they previously published none at all, which is why every prior
subtopology was reconciled as unsupported on rebuild). A prior subtopology that
is `IsSame` as a subtopology of the result IS that entity — shape identity, not
geometry, not tolerance. Only one-to-one claims are made: anything shared by two
prior entities, absent, or already claimed by the kernel's own history is left to
the kernel's classification. The genuinely consumed edge stays unsupported. The
rigid-transform stage builder was already exactly this, so it was generalized
(`createRigidTransformTopologyStage` → `createExactSuccessorTopologyStage`,
source-key prefix `rigid-transform:` → `exact-successor:`) rather than duplicated.

Real-kernel effect, visible in the X.9.3 flywheel: the stale-reference refusals
are gone and the affected features now report the kernel's real build outcome.

| Feature | Before | After |
|---|---|---|
| 9841 `Chamfer 2` | `occ-topology-unsupported-history` (stale reference) | `feature-kernel-build-failed` (real build refusal) |
| 5151 `Chamfer 2` / `Chamfer 3` | `occ-topology-unsupported-history` | `advanced-feature-unsupported-kernel-case: OCC chamfer build failed` |
| 5151 `Extrude 3` | quoted Chamfer 1's stale-reference refusal | quotes the real chamfer build failure |

Pinned in the logic lane (`fillet-chamfer.spec.ts`, real OCC): an untouched edge
keeps an exact successor claim and is not invalidated, while the consumed edge
stays unsupported and never receives a fabricated successor.

**Honest residual — tiers do not move.** The lineage gap was real and is closed,
but it was not the *binding* constraint for any feature in these captures. Every
affected chamfer now fails one step later, on its own geometry, for a reason the
kernel owns. Tier counts are unchanged and are reported as such rather than being
tuned:

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 10 / 31 / 0 | **10 / 31 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** |

#### Remaining baked features, classified

*Needs follow-up (a real next root cause, now visible because the lineage gap no
longer masks it):*
- 9841 `Chamfer 2`, 5151 `Chamfer 2` / `3`: the live chamfer **build** fails on
  the live prefix geometry. This is the next flywheel iteration and is a chamfer
  *geometry/width-form* question, not a naming one.
- 9841 `Shell 1`, `Boolean 1`, `Delete part 1`, `Split 1` and the extrudes then
  read as quoting `baked-body-assetMissing`. **Superseded** — see "the probe's
  bake-checkpoint blind spot" below: that reading was not reproducible against the
  real browser gate (no studio review contains `assetMissing` at all). These
  features cascade behind 9841 `Chamfer 2`, whose real root cause is
  generated-entity stage lineage.
- 5151 `Fillet 2`: honest `topology-reference-no-match` — the captured `JIR` edge
  agrees with no live candidate on the analytic gates (per-candidate rejections
  are preserved in `reasonDetail`).

*Honestly unresolvable with this capture set:*
- 9841 `Extrude 10` / `11` / `15` / `16`, 5151 `Extrude 6` / `7`, d3cd9
  `Extrude 8`: `extrude-start-extent-unsupported`. BLIND start offsets have no
  sign ground truth here; guessing would displace geometry.

*Excluded scope (unchanged):*
- 9841 `Extrude 4` and d3cd9 `Extrude 4`: `extrude-body-type-unsupported`
  (SURFACE), permanently baked.
- `Split 1` (both studios), 9841 `Sketch 3` / `4`, d3cd9 `Sketch 7` / `8` +
  `Extrude 8`, and their direct dependents.

#### X.5 face-backed sketches: not attempted, and why

**Superseded** — see "the probe's bake-checkpoint blind spot" below. X.5 was
subsequently attempted; the `baked-body-assetMissing` blocker named here was
disproved, and the real blocker is that these sketches' owning bodies are absent
from the live prefix, gated on 9841 `Chamfer 2`.
9841 `Sketch 2` / `5` / `6` / `9` / `10` and `Cutter` remain
`needs-history-probe`. Promotion requires a live body face to resolve against,
and in this capture every one of those sketches sits **behind** a prefix the
probe cannot currently rebuild (the `baked-body-assetMissing` class above).
Wiring durable `SketchPlaneSupportRef` onto live faces without first fixing that
would either resolve against a body apply never presents, or fabricate an
`owningFeatureId`. Both are excluded by the ground rules, so X.5 stays open with
its blocker now precisely named rather than being closed on a guess.

#### Verdicts

- **X.9.2 (chamfer/fillet lineage):** the diagnosed defect is **fixed and pinned**.
  It did not raise tiers in these captures; the next blockers are named above.
- **X.5 (face-backed sketches):** **open**, blocked on probe-session checkpoint
  materialization rather than on matching. *(Superseded below: that blocker was
  disproved; the real one is the missing owning body in the live prefix.)*

Validation: `bun run lint`, `bun run build`, `bun run test` (logic + UI +
static), and `bun run test:e2e` (**67 passed / 0 failed**, real bundles, clean
port 3123) are all green.

### Item-D follow-ups: the probe's bake-checkpoint blind spot (X.5 prerequisite)

**The named `baked-body-assetMissing` blocker did not exist.** The previous
iteration's framing — that the probe runs prefixes with `materializeBake: false`
so any prefix containing a bake checkpoint fails with `baked-body-assetMissing` —
was checked against the real browser gate first and is **not reproducible**. A
full review dump of all three studios contains **zero** occurrences of
`assetMissing` (`grep -c` over the rendered review text: 9841 `0`, 5151 `0`,
d3cd9 `0`). Nothing was "fixed" there because nothing was broken: `materializeBake`
gates the monolithic whole-studio bake, while `emitBakeCheckpoints` (already
`true` on the containment probe) emits the segment checkpoints, and the browser
probe resolves their asset bytes through the shared geometry-asset composition.
The X.4 note's "checkpoint materialization is browser-inert" caveat is likewise
stale — the browser gate now commits `feature_bakedBody-1` in every affected
studio.

**The real blind spot was ordering, and it was invisible.** The face-backed
sketch pass ran *before* the containment pass. So it probed a prefix that still
contained features the live kernel refuses (9841 `Chamfer 2`). Such a prefix
fails wholesale, the probe returns no signatures at all, and every face-backed
sketch behind it saw an **empty live prefix** — a probe-session artifact, not a
matching failure. Four exits in that loop returned the plan unchanged with no
`reasonDetail`, so the generic `needs-history-probe` copy hid it completely.
That is exactly why the previous iteration had to guess at a cause.

Fix, at the honest seam and in two commits:

1. **Extend the X.9.3 `reasonDetail` flywheel into the sketch loop.** All four
   silent exits now name their cause: no captured signature, a failed prefix
   (kernel diagnostic preserved verbatim), a non-unique match (zero/one/many with
   each live candidate's rejection gates plus a live-prefix census), and a matched
   face exposing no planar frame. Purely diagnostic; it never participates in
   matching or tier selection.
2. **Contain before probing, lazily.** When a sketch prefix fails to rebuild, the
   provider now runs the existing containment pass and re-probes once, so the
   prefix the sketch matches against is the one apply will actually build.
   Containment rebuilds the whole studio in the kernel, so running it eagerly on
   every fixed-point iteration cost d3cd9 ~160 s (571 s → 731 s) and blew its
   Playwright review budget. It is therefore triggered only by an actual prefix
   failure and memoized on the plan fingerprint it already proved buildable
   (d3cd9 back to 576 s).

The flywheel paid out immediately, in three steps, on 9841's face sketches:

| Iteration | 9841 `Sketch 2` / `5` / `6` / `9` / `10` / `Cutter` `reasonDetail` |
|---|---|
| before | *(none — silent `needs-history-probe`)* |
| after (1) | `sketch plane wants face/plane \|\| no live face matched; rejected nothing (the live prefix exposed no candidates) \|\| live prefix 0: empty` |
| after (1), prefix status surfaced | `kernel-history-probe-step-failed: History probe failed at step 10: occ-topology-unsupported-history: Chamfer 2 edge selection is incorrect.` |
| after (2) | `sketch plane wants face/plane \|\| no live face matched; rejected face_body_feature_extrude-1_…: normal-angle-out-of-tolerance,plane-offset-out-of-tolerance,… \|\| live prefix 39: body/solidx1,face/planex8,edge/linex18,vertex/pointx12` |

The probe now presents the same body state apply does, and the bake is honest
per-candidate matching against a real live prefix instead of an empty one.

#### X.5 face-backed sketches: attempted, and the honest blocker

X.5 was attempted and is **still open**, but its blocker is now proven rather
than assumed, and it is a *different* blocker than the one previously recorded.

With containment ordered correctly, 9841's face-backed sketches probe a live
prefix of **39 signatures — but only one body, `body_feature_extrude-1`.** Those
sketches are authored on faces of bodies produced by extrudes that are themselves
still baked, so no live face they could resolve against exists in the prefix at
all. Every one of the 8 live planar faces is rejected on
`normal-angle`/`plane-offset`/`bounding-box` gates — the correct answer for faces
of the wrong body.

So no `SketchPlaneSupportRef` wiring was landed: with zero candidate faces from
the owning body, any promotion would resolve against a body apply never presents
or require fabricating an `owningFeatureId`. Both are excluded by the ground
rules. **X.5 is gated on 9841 `Chamfer 2`** (below) and the extrude cascade behind
it, not on face resolution or on `SketchPlaneSupportRef` plumbing.

#### 9841 `Chamfer 2`: root cause found (generated-entity lineage)

The chamfer/fillet lineage fix recorded above closed the `IsDeleted`
over-reporting gap for *prior* subtopology. It did not cover subtopology the
chamfer **generates**, and that is what 9841 `Chamfer 2` selects.

Diagnosed in the real OCC kernel (never the mock), with a temporary harness over
`executeChamferFeature` on a single-chamfer box:

| result entity | count | has a stage source key |
|---|---:|---|
| faces | 7 | 6 |
| edges | 15 | 11 |
| vertices | 10 | 6 |
| **generated by the chamfer** | **9** | **none** |

`createExactSuccessorTopologyStage` enumerates only `getExactSuccessorSourceTargets(sourceBody)`
— the *prior* body's subtopology. The chamfer's new face, its 4 new edges and 4
new vertices are in the output body but appear in no `sourceTargets` entry. On
rebuild, `classifySemanticStageTopology` sees `sourceKeys.length === 0` for each
of them and invalidates them as `occ-topology-unsupported-history`.

That is precisely 9841 `Chamfer 2`'s failure: its captured edges (`JNR`, `JPZ`,
`JPd`, `JPF`, `JPJ`) are the chamfer surface's own boundary edges, created by
`Chamfer 1`. Sequential apply survives it (the invalidation is only consulted on
replay); the rebuild path — which the probe and apply both run — refuses it.

The fix is a producer-identity claim for generated entities (an entity a feature
created is owned by that feature, which is exact identity, not a match) and is
**not landed here**: it changes the topology-stage contract for every local
operation, needs its own real-kernel rebuild pins, and this session's budget went
to proving the cause rather than guessing at it. It is recorded as the single
next root cause for 9841, and it is what gates X.5 in this capture.

#### Verdicts (updated)

- **X.5 (face-backed sketches):** **open**. Its previously recorded blocker
  (probe-session checkpoint materialization / `baked-body-assetMissing`) was
  disproved. Its real blocker is that the sketches' owning bodies are not in the
  live prefix, gated on 9841 `Chamfer 2`'s generated-entity lineage.
- **X.9.2 residuals:** 9841 `Chamfer 2` is root-caused (generated-entity stage
  lineage) and awaiting the contract change. 5151 `Chamfer 2` / `3` and
  `Fillet 2` are unchanged and still name their own kernel/matching reasons.
- **Probe blind spot:** **closed** for observability (every face-sketch bake now
  names its cause) and **closed** for ordering (containment precedes the sketch
  match whenever a prefix fails).

Tiers are unchanged and are reported as such rather than tuned:

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 10 / 31 / 0 | **10 / 31 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** |

Logic-lane pins (`provider.spec.ts`): an unresolved face sketch records the
zero/one/many detail plus a live-prefix census, and containment stays lazy but
fires and re-probes once a sketch prefix fails.

### Item-D follow-ups: generated-entity producer identity, and the native-shim wall

**The generated-entity lineage gap is closed in the topology-stage contract, and
the cascade did not move. The reason is a second, distinct defect underneath it,
now located precisely.**

#### What was verified (real OCC, never the mock)

The previous iteration's diagnosis reproduces exactly. On a single chamfer of a
box, `createExactSuccessorTopologyStage` enumerates only the prior body's
subtopology, so the 9 entities the chamfer creates carry no source key at all:

| result | count | claimed by stage lineage |
|---|---:|---:|
| faces | 7 | 6 |
| edges | 15 | 11 |
| vertices | 10 | 6 |
| **generated by the chamfer** | **9** | **0** |

On rebuild `classifySemanticStageTopology` sees `sourceKeys.length === 0` for
each and invalidates it as `occ-topology-unsupported-history`.

#### The landed fix: producer identity from builder history only

Generated entities now receive a deterministic per-feature stage key claiming the
**producing** feature's identity:

```
generated-from:<ownerFeatureId>:<sourceBodyId>:<sourceKind>:<sourceStageId>:<role>
```

with `role` = `generated-face` / `generated-edge` / `generated-vertex`. The
attribution comes from `BRepFilletAPI::Generated(source)` and nothing else — no
geometry, no traversal order, no tolerance. Honesty rules, all pinned:

- a generated shape resolving to anything other than exactly one result entity is
  **not** claimed;
- an entity reachable from two sources is **many** → both claims dropped;
- an entity already claimed by the `IsSame` exact-successor pass keeps that claim
  and the producer claim is dropped (an entity cannot both survive and be new);
- the untouched-entity one-to-one pass from `0391b53a` is unchanged.

`createExactSuccessorTopologyStage` takes the claims through a new optional
`generatedTargetsBySourceKey`, so every current user (fillet, chamfer, mirror /
rigid transform) shares one contract. Users whose builder exposes **no** exact
history (`shell`, `loft`, `sweep`, `thicken`, `hole`, `pattern`, replay) keep
`createUnsupportedProducerTopologyStage` — producer identity was deliberately not
forced where history is absent.

Pinned in the logic lane (`fillet-chamfer.spec.ts`, real OCC): a chamfer publishes
producer keys for every face it generates; an **upstream parameter edit
reproduces byte-identical producer keys**, so `classifySemanticStageTopology`
keeps the generated face live across the rebuild instead of invalidating it; an
unsupported producer key still invalidates; and a producer key reaching two
successors is reported ambiguous.

#### The honest blocker: the native shim destroys the only witness

**Tiers do not move, and the reason is specific.** `Generated` is answerable only
while the builder that produced the committed shape is alive. The equal-offset
chamfer and the fillet commit through
`BuildChamferCommittedShapeTransactionWithHistory` /
`BuildFilletCommittedShapeTransactionWithHistory`, and
`CadaraBuildLocalOperationTransactionResult` destroys its `BRepFilletAPI` inside
the shim. Its history payload
(`CadaraAppendHistoryRecordsForKind`) iterates the **previous** shape's subshape
map only, so a generated entity appears in no record — verified: 26 records, all
keyed by prior subshapes, 10 named successors, and the chamfer face named nowhere.

Every cascade-blocking chamfer in these captures is `EQUAL_OFFSETS` (9841
`Chamfer 1`/`2`/`4`, 5151 `Chamfer 1`/`2`/`3`), i.e. exactly the native path. So
the contract is in place but the affected features cannot yet reach it.

Two routes were considered and **rejected** as fabricated identity:

1. Re-running an identical `BRepFilletAPI` in JS beside the native transaction and
   transferring its `Generated` answer. The two runs produce different `TopoDS`
   shapes (`IsSame` across them is `false`), so the transfer can only be made
   through coincident geometry digests — nearest-geometry matching under another
   name.
2. Making the whole local-operation path prefer the JS builder. That changes the
   committed shape for every existing fillet/chamfer (the native path additionally
   runs `CadaraPrepareCommittedShape`), which is a geometry change smuggled in as a
   naming fix.

**The correct fix is one shim change:** have
`CadaraAppendHistoryRecordsForKind` additionally emit, per prior subshape, the
`Generated` successors keyed with a `generated` reason, so producer identity
survives into the payload the way the JS path already supports. That requires
editing `occ-native-shims/cadara-native-topology-helpers.inc`, extending
`OccNativeFeatureTransactionHistoryReason`, and **rebuilding the Wasm** via
`docker run … donalffons/opencascade.js opencascade-recipe.yaml`. No container
runtime is available in this environment (`docker`/`podman` both fail to start:
`/run/user/1000` does not exist), so `public/cadara-occ.wasm` cannot be
regenerated here. This is recorded as the single next blocker rather than worked
around.

#### Cascade re-walk outcome

Unblocked: none. 9841 `Chamfer 2` still refuses on the native path, so its
dependents (`Chamfer 3`/`4`, `Boolean 1`, `Delete part 1`, `Shell 1`, the extrudes
behind them) stay baked, and X.5's face sketches still see a live prefix that
contains only `body_feature_extrude-1`. 5151 `Chamfer 2`/`3`, `Fillet 2` and
d3cd9's residuals are likewise unchanged. Nothing was promoted on a guess.

Tiers, reported as measured on the real browser gate (clean port 3123):

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 10 / 31 / 0 | **10 / 31 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** |

The `walls` and `screwHole` variable rebuilds still pass with zero snapshot
diagnostics, and the 5151 `Wall` rebuild holds at its pinned single
region-identity diagnostic.

#### Verdicts (updated)

- **X.9.2 (generated-entity producer identity):** the contract is **landed and
  pinned**, including cross-rebuild determinism and zero/one/many honesty. It is
  **not yet reachable** by the affected captures, which all commit through the
  native transaction; that is one shim change plus a Wasm rebuild away.
- **X.5 (face-backed sketches):** **open**, unchanged, still gated on 9841
  `Chamfer 2`. No `SketchPlaneSupportRef` wiring was landed, because with zero
  candidate faces from the owning body any promotion would fabricate identity.

Validation: `bun run lint`, `bun run build`, `bun run test` (666 logic + 126 UI +
24 static), and `bun run test:e2e` (**67 passed / 0 failed**, real bundles, clean
port 3123) are all green.

### Item-D follow-up: the native `generated` history record is prepared

**The shim change named as the single correct fix above is now written and
committed. Nothing else in this repository blocks it; the remaining step is one
external Wasm rebuild, which cannot run in this environment.**

#### What landed

`occ-native-topology-helpers.inc` gains
`CadaraAppendGeneratedHistoryRecordsForKind`, called from
`CadaraBuildFeatureHistoryJson` for `FACE`, `EDGE` and `VERTEX` after the three
existing `CadaraAppendHistoryRecordsForKind` calls. Per prior subshape it asks
the live builder for `Generated(previousSubshape)`, keeps only results present in
the final shape, and emits one record

```
{"target":<prior subshape>,"reason":"generated","successors":[<generated entities>]}
```

Unlike the modified/deleted pass, the successors may be of a different kind than
the target — a chamfered edge generates a face — which is exactly the attribution
that was previously destroyed with the builder. Prior subshapes with no generated
results emit nothing, so the payload does not grow for operations that create
nothing. Ordering and dedup follow the existing records: previous-map order,
first occurrence wins.

On the TS side `OccNativeFeatureTransactionHistoryReason` gains `generated`;
`collectNativeHistoryResolution` routes those records to
`collectNativeGeneratedClaims`, which mirrors the JS builder path's honesty rules
exactly — a record naming anything other than one entity claims nothing, an
entity reachable from two sources is many so both claims drop, and a `generated`
record never invalidates the prior entity it is attributed to.
`reconcileNativeHistoryReplacement` rewrites the surviving claims through the
replacement's native-id aliases and returns them as
`generatedTargetsBySourceKey`, keyed with the same
`formatGeneratedProducerTopologySourceKey` the JS path uses, and
`collectLocalOperationTopologyStages` feeds them into
`createExactSuccessorTopologyStage` when no live JS builder is available.

**The change is inert until the Wasm is rebuilt.** The checked-in
`public/cadara-occ.wasm` never emits `reason: "generated"`, so every native
transaction still produces an empty `generatedTargetsBySourceKey` and every tier
is unchanged (`bun run test` 667 logic + 126 UI + 24 static, `bun run test:e2e`
67 passed / 0 failed on clean port 3123). That is intentional: no fallback was
added to approximate the missing records.

#### The one remaining step

From the repository root, with a working container runtime:

```
docker run --rm -it -v "$(pwd):/src" -u "$(id -u):$(id -g)" \
  donalffons/opencascade.js opencascade-recipe.yaml
```

(that command is the header comment of `opencascade-recipe.yaml`, whose
`mainBuild.name` is `cadara-occ.js`; the products replace `public/cadara-occ.js`
and `public/cadara-occ.wasm`). Podman and Docker both fail to start here
(`/run/user/1000` does not exist), so this is the user's step, not an
unimplemented one.

After that rebuild lands, re-walk in this order:

1. 9841 `Chamfer 2` — confirm its generated face now carries a producer key and
   `classifySemanticStageTopology` keeps it live instead of
   `occ-topology-unsupported-history`.
2. Its dependents `Chamfer 3`/`4`, `Boolean 1`, `Delete part 1`, `Shell 1` and
   the extrudes behind them.
3. 5151 `Chamfer 1`/`2`/`3` and `Fillet 2`, then d3cd9's residuals.
4. X.5's face-backed sketches, whose live prefix should finally contain more than
   `body_feature_extrude-1`.

Re-measure tiers on the real browser gate before promoting anything.

Logic-lane pin (`boolean-operations.spec.ts`, seam:
`resolveNativeFeatureTransactionReplacement`): a synthesized native payload
carrying `generated` records produces the expected
`generated-from:<feature>:<body>:edge:<edgeId>:generated-face` key for a
one-to-one claim, claims nothing when two sources reach one entity, claims
nothing when one record names two entities, and never invalidates the attributed
prior entity.

### Item-D follow-up: the regenerated Wasm, and the first cascade promotion

**The rebuilt Wasm works, and it moved a tier for the first time in three
iterations: 9841 `Chamfer 2` is parametric.** It took the native records *plus*
one more exact identity the kernel cannot supply.

#### Wasm sanity: the shim change is live and well formed

The full logic suite for `src/domain/modeling` + `src/domain/import` is green
(74 files / 397 tests) against the regenerated `public/cadara-occ.wasm`, and a
real-OCC scratch harness over the native `EQUAL_OFFSETS` chamfer transaction
confirms the payload directly. For one chamfer on one edge of a box:

| history reason | records |
|---|---:|
| `unique-successor` | 10 |
| `deleted` | 16 |
| **`generated`** | **1** |

The single `generated` record is exactly the intended attribution — target: the
chamfered edge, successor: the chamfer face, of a *different* kind than its
target — and it reaches `executeChamferFeature`'s topology stage as
`generated-from:<feature>:<body>:edge:<priorEdgeId>:generated-face`. Nothing is
malformed and no shim change is outstanding. Pinned in the logic lane
(`fillet-chamfer.spec.ts`, real OCC, seam: `executeChamferFeature` on the native
equal-offset path): the producer key exists, claims exactly the generated face,
reproduces byte-identically across an upstream parameter edit, and
`classifySemanticStageTopology` keeps that face live across the rebuild.

#### The honest gap the Wasm could not close, and the exact fix

`BRepFilletAPI::Generated` answers with the chamfer/fillet **surface only**. The
shim faithfully forwards exactly what the builder knows, so of the 9 entities a
single chamfer creates, the payload names **1**:

| created entity | count | claimed after the Wasm rebuild |
|---|---:|---:|
| faces | 1 | 1 |
| edges | 4 | **0** |
| vertices | 4 | **0** |

And 9841 `Chamfer 2` selects an **edge**. The X.9.3 flywheel was extended to name
the refused durable target in a probe refusal (the authored-field message says
only "edge selection is incorrect"), which pinned it to one entity:
`edge_body_feature_extrude-1_g7965235ff6189076`, invalidated with
`occ-topology-unsupported-history` — the reason reserved for an entity present in
the live body that carries no source key at all. Deleted and ambiguous entities
own different reason codes, so the class was identified by exclusion using only
reasons the kernel itself owns.

There is no kernel answer for those edges and vertices, and inventing one from
geometry was excluded. The one exact route left is **combinatorial**: a
subtopology is uniquely determined by the faces it bounds, and after the two
existing passes every one of those faces already carries a stage claim. So a
created edge/vertex is now keyed by its bounding faces' own claim keys:

```
generated-from:<owner>:<body>:adjacent(<sorted adjacent claim keys>):<role>
```

No coordinates, no tolerance, and no traversal order participate; the input is
the shape's topology graph. Honesty rules, all pinned: a bounding face without a
claim makes the signature unreproducible, so the entity stays unclaimed; a
signature reached by two entities is many, so neither claims it; an entity the
exact passes already claimed is never overridden; and adjacency claims never run
for faces (`Generated` owns those).

Pinned in the logic lane (`fillet-chamfer.spec.ts`, real OCC): a native
equal-offset chamfer claims all 4 created edges and all 4 created vertices, an
upstream parameter edit reproduces identical adjacency keys, every one of those
entities survives `classifySemanticStageTopology` across that rebuild, nothing
previously claimed is disturbed (`invalidations.size === 0`), and an unsupported
adjacency key still invalidates its entity honestly.

#### Cascade re-walk (real browser gate, clean port 3123)

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 10 / 31 / 0 | **11 / 30 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** |

9841 per-feature outcomes:

| Feature | Before | After |
|---|---|---|
| `Chamfer 2` | `occ-topology-unsupported-history` (refused `edge_…g7965235ff6189076`) | **parametric**, committed as `feature_chamfer-2` |
| `Shell 1` | `topology-apply-rematch-failed` (no detail) | same code, now with detail: `wants body for JND; live match noMatch \|\| rejected nothing \|\| live prefix 0: empty` |
| `Chamfer 3` / `4` | quoted `Chamfer 2`'s refusal | own honest `topology-reference-no-match` (`J0x`, `J2J`) |
| `Boolean 1`, `Delete part 1` | quoted `Chamfer 2`'s refusal | own honest `topology-reference-no-match` (`JbH`, `J5D`) against the live baked bodies |
| `Extrude 2` | quoted `Chamfer 2`'s refusal | `extrude-extent-topology-unresolved` behind `Shell 1` |
| face sketches (`Sketch 2`/`5`/`6`/`9`/`10`, `Cutter`) | live prefix 39 signatures | live prefix **61** signatures (13 planar faces), still no face of the owning body |

The upstream-edit proof is in the browser gate: the `walls` variable edit
rebuilds the whole committed timeline and `feature_chamfer-2` survives it with
zero snapshot diagnostics, which is only possible if the adjacency claims
re-derive identically through the rebuild.

5151 and d3cd9 did not move and their pinned reasons are unchanged: 5151
`Chamfer 1`/`2` are `topology-apply-rematch-failed`, `Chamfer 3` and `Fillet 2`
are `topology-reference-no-match` (`Jcl`, `JIR`), `Boolean 1` quotes `Extrude 4`'s
real kernel build failure, and d3cd9's `Extrude 5`/`6`/`7` are all
`downstream-of-baked` behind the excluded `Sketch 7`/`8`. 5151 `Extrude 6`/`7`
stay `extrude-start-extent-unsupported`; their producer sketches did not become
live, so nothing unlocked there.

#### X.5: still open, with a new and much more specific blocker

No `SketchPlaneSupportRef` wiring was landed, and the reason is again evidence
rather than assumption. With `Chamfer 2` live the face-sketch live prefix grew
from 39 to 61 signatures, but it still contains exactly one body
(`body_feature_extrude-1`): every one of its 13 planar faces is rejected on
`normal-angle` / `plane-offset` / `bounding-box` gates, which is the correct
answer for faces of the wrong body. The sketches are authored on faces of the
body `Extrude 2` produces, and `Extrude 2` is baked behind **`Shell 1`**.

So X.5's blocker moved from 9841 `Chamfer 2` to 9841 `Shell 1`, and the flywheel
now names `Shell 1`'s cause precisely. The apply-time rematch detail is new this
iteration (`TopologyApplyRematchError` carries a verbatim zero/one/many detail
that the contained bake preserves), and it says the match ran against an **empty
live prefix**: `live prefix 0: empty`, `rejected nothing`. That is not a matching
failure. `deriveLiveBodySignatures` reported `available` — the unavailable branch
would now print its own diagnostics verbatim instead of degrading silently to a
no-match — so the snapshot that resolution ran against genuinely contained no
bodies at all. `Shell 1`'s deferred `parts`/`JND` body selector is therefore being
resolved against a session that has not built the prefix, which is an ordering
question at the deferred-materializer seam, not a naming or tolerance one. It is
recorded as the single next root cause rather than worked around.

Logic-lane pin (`provider.spec.ts`, seam: review's contained apply-rematch bake):
a `TopologyApplyRematchError` carrying a detail must surface it verbatim as the
baked plan's `reasonDetail`.

#### Remaining bakes, classified

*Needs follow-up (a real next root cause, each now named):*
- 9841 `Shell 1`: `topology-apply-rematch-failed` against an empty live prefix
  (above). Gates `Extrude 2` and all of X.5.
- 9841 `Chamfer 3` / `4`, `Boolean 1`, `Delete part 1`: honest
  `topology-reference-no-match`. Their captured entities live on bodies later
  extrudes produce, so they cascade behind the extrude gaps rather than behind a
  lineage gap.
- 9841 `Extrude 3` / `15` / `16`: `extrude-start-extent-unsupported` even though
  the census lists them as `startOffsetBound=ENTITY`. `Extrude 1` proves that
  form is supported, so these three author something the exact `qCompressed`
  sketch-point reader does not accept; worth one flywheel iteration.
- 5151 `Chamfer 1` / `2`: `topology-apply-rematch-failed` (same class as 9841
  `Shell 1`). 5151 `Chamfer 3` / `Fillet 2`: honest `topology-reference-no-match`.
- 5151 `Boolean 1` / `Extrude 3` / `8`: quote `Extrude 4`'s real kernel build
  failure.

*Honestly unresolvable with this capture set:*
- 9841 `Extrude 10` / `11`, 5151 `Extrude 6` / `7`, d3cd9 `Extrude 8`:
  BLIND start offsets have no sign ground truth here.

*Excluded scope (unchanged):*
- 9841 `Extrude 4` and d3cd9 `Extrude 4`: `extrude-body-type-unsupported`
  (SURFACE), permanently baked.
- `Split 1` (both studios), 9841 `Sketch 3` / `4`, d3cd9 `Sketch 7` / `8` +
  `Extrude 8`, and their direct dependents (d3cd9 `Extrude 5` / `6` / `7` are
  `downstream-of-baked` behind `Sketch 7` / `8`).

#### Verdicts (updated)

- **X.9.2 (generated-entity producer identity):** **closed.** The native records
  are live and pinned, and the half `Generated` cannot answer — created edges and
  vertices — is now named by exact bounding-face identity. This is the change that
  finally promoted 9841 `Chamfer 2` and its committed timeline entry.
- **X.5 (face-backed sketches):** **open**, no wiring landed, blocker moved from
  9841 `Chamfer 2` to 9841 `Shell 1`'s empty-live-prefix rematch. Promoting
  against a body apply never presents, or fabricating an `owningFeatureId`, both
  stay excluded.

Validation: `bun run lint`, `bun run build`, `bun run test` (logic + UI + static),
and `bun run test:e2e` (67 passed / 0 failed, real bundles, clean port 3123).

### Item-D follow-up: the speculative prefix probe, and the Shell 1 promotion

**9841 `Shell 1` and `Extrude 2` are parametric.** The
`topology-apply-rematch-failed` detail (`live prefix 0: empty`) was accurate and
its cause was ordering, exactly as recorded — but the empty prefix was not the
*apply* prefix. It was a **speculative pre-consumer prefix belonging to a
different feature**.

#### The root cause, from a real-kernel review of the actual bundles

A node-side real-OCC review of each local capture (real `public/cadara-occ.wasm`,
never the mock) reproduces the browser gate exactly (9841 `11 / 30 / 0`), and
instrumenting the probe capability names the offending probe unambiguously:

| probe | consumer | ordered action sequence |
|---|---|---|
| 8 | `Ff2Ps8hMrKL549G_1` (face/edge consumer) | `…, Sketch 1, Incline, Screen Outline, Side Outline, Shell 1` |

`Extrude 1`, `Chamfer 1` and `Chamfer 2` are **absent** from that sequence. A
pre-consumer prefix for a face/edge consumer deliberately suppresses bake
checkpoints (`emitBakeCheckpoints: consumesOnlyBodies`), so at that iteration —
when those three features were still baked — the whole baked run contributed
*nothing*: no parametric features and no checkpoint bodies. `Shell 1` sat inside
that prefix, its deferred `parts`/`JND` body selector was materialized against a
genuinely empty session, and the resulting throw escaped
`activateProbeBackedPlanning`. `reviewStudio` treats such a throw as apply-time
evidence and force-bakes the feature for the rest of the review
(`forcedBakeFeatureIds` is never re-promoted), so `Shell 1` was condemned by a
probe that could not have built it, iterations before the prefix it needed
existed. 5151 `Chamfer 1` / `Chamfer 2` were condemned the same way, from
prefixes that placed a `Fillet 2` / `Extrude 4` checkpoint ahead of them.

#### The fix: contain the failure at the seam that owns it

`probeTopologyConsumerPrefixes` now catches `TopologyApplyRematchError` and
reports it as a **failed prefix for the consumer being probed**, with the
verbatim zero/one/many detail preserved in the step diagnostic. The offending
feature stays eligible. Nothing is relaxed and nothing is matched by proximity:
the whole-plan verification and containment probes — which build the same ordered
sequence apply runs, checkpoints included — still throw, and `reviewStudio` still
force-bakes from those. Only the speculative, deliberately-reduced prefix loses
the authority to decide another feature's tier.

Pinned in the logic lane (`topology-resolution-planner.spec.ts`, seam:
`probeTopologyConsumerPrefixes`): a rematch failure becomes a failed prefix
carrying the detail verbatim, and any other error still propagates.

#### The cost, and the memoization that paid for it

Keeping `Shell 1` eligible costs iterations: 9841 went from 94 probe evaluations
in 268 s to 94 in 1299 s (each rebuild now carries more live geometry), which blew
the browser review budget. Only **28** of those 94 payloads were distinct. A probe
evaluation rebuilds its prefix in a fresh isolated session, so it is a pure
function of the prepared-action payload; `createMemoizedHistoryProbe` memoizes on
that payload for the duration of one studio review. A failed or throwing
evaluation is never retained, because it is the input to the containment pass that
exists to change the conditions it failed under (pinned in
`kernel-history-probe.spec.ts`).

| studio | review before | review after |
|---|---:|---:|
| Mounts `40a51…` | 7 s / 5 probes | **7 s / 5 probes** |
| Laptop Stand `5151…` | 235 s / 39 probes | **104 s / 22 probes** |
| Part Studio 1 `9841…` | 268 s / 94 probes | **349 s / 28 probes** |
| Part Studio 1 `d3cd9…` | 489 s / 13 probes | **228 s / 8 probes** |

The 9841 Playwright gate went from exceeding its 1 500 000 ms review cap to
**7.1 min for the whole test**, including the `walls` rebuild.

#### Cascade re-walk (9841 at the real browser gate; the rest at the real-OCC node review)

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 11 / 30 / 0 | **13 / 28 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** |

9841 per-feature outcomes:

| Feature | Before | After |
|---|---|---|
| `Shell 1` | `topology-apply-rematch-failed` (empty speculative prefix) | **parametric**, committed as `feature_shell-1` |
| `Extrude 2` | `extrude-extent-topology-unresolved` behind `Shell 1` | **parametric**, committed as `feature_extrude-2` |
| face sketches (`Sketch 2`/`3`/`4`/`5`/`6`/`7`/`9`/`10`, `Cutter`) | live prefix exposed no face of the owning body | live prefix now exposes the post-`Extrude 2` body; every planar face is rejected on `normal-angle` / `plane-offset` / `bounding-box` |

The upstream-edit proof is in the browser gate: the `walls` variable edit rebuilds
the committed timeline and both `feature_shell-1` and `feature_extrude-2` survive
it with zero snapshot diagnostics, which is only possible if `Shell 1`'s deferred
body selector rematches identically through the rebuild.

5151 did not move, and its two rematch failures are now attributed by the
apply-order probes instead of a speculative one. Their detail names the real
obstacle exactly: the only live candidate is `body_feature_bakedBody-1` — a bake
checkpoint **replaces the very body whose edge they select** before they run. A
tessellation-backed checkpoint body exposes body identity only, so no
sub-topology of it can exist; recovering those chamfers needs their checkpoint's
boundary feature (`Fillet 2`, `Extrude 4`) to become parametric, not a matching or
tolerance change.

#### 9841 `Extrude 3` / `15` / `16`: the census label was right, the entity is not a vertex

Dumped from the bundle with `jq`, all three author `startOffset=true`,
`startOffsetBound=ENTITY` — and their `startOffsetEntity` query is
`entityType=EDGE`, not `VERTEX`:

| feature | `startOffsetEntity` query shape |
|---|---|
| `Extrude 1` (works) | `entityType=VERTEX`, `queryType=SKETCH_ENTITY`, `operationId=…wireOp`, `sketchEntityId=…top.end` |
| `Extrude 3` | `entityType=EDGE`, `queryType=SKETCH_ENTITY`, `disambiguationData` → `derivedFrom` `FACE` of `Extrude 1` (`SWEPT_FACE`) and `FACE` of `Shell 1` (`OFFSET_FACE`) |
| `Extrude 15` / `16` | `entityType=EDGE`, `queryType=SKETCH_ENTITY`, `derivedFrom` `FACE` of a prior extrude (`CAP_EDGE`), `isStart=F` |

So the start bound is a **live body edge**, named through its bounding faces, not
a sketch vertex. `readSketchEntityVertexQuery` rejects them on
`entityType !== "VERTEX"`, which is correct: there is no vertex in the payload to
decode, and mapping an edge onto a start plane is not decoding. Extending the
sketch-point reader would be fabrication. These need a start extent bound to a
resolved topology slot (a new `ExtrudeStartExtent` form plus a kernel start plane
derived from a durable edge) — a contract-level item, not a reader extension.
`extrude-start-extent-unsupported` stays the honest reason, now with a named next
step.

#### Remaining bakes, classified

*Needs follow-up (each named):*
- 9841 face-backed sketches (X.5): the live prefix finally exposes the owning
  body, and every candidate face is rejected on analytic gates
  (`normal-angle` / `plane-offset` / `bounding-box`). The next root cause is the
  frame the captured sketch-plane signature is expressed in versus the live face
  frame — a per-candidate matching question, no longer an empty prefix.
- 9841 `Chamfer 3` / `4`, `Boolean 1`, `Delete part 1`: honest
  `topology-reference-no-match` (`J0x`, `J2J`, `JbH`, `J5D`). `Boolean 1` and
  `Delete part 1` reject the two checkpoint bodies on `bounding-box`, so they sit
  behind the same checkpoint-replacement wall as 5151's chamfers.
- 5151 `Chamfer 1` / `2`: blocked by a bake checkpoint replacing their target
  body (above). 5151 `Chamfer 3` / `Fillet 2`: honest
  `topology-reference-no-match`.
- 9841 `Extrude 3` / `15` / `16`: an `ENTITY` start bound against a live body edge
  (above). 5151 `Extrude 6` / `7` stay `extrude-start-extent-unsupported`.

*Honestly unresolvable with this capture set:*
- 9841 `Extrude 10` / `11`, d3cd9 `Extrude 8`: BLIND start offsets have no sign
  ground truth here.

*Excluded scope (unchanged):* 9841 `Extrude 4` and d3cd9 `Extrude 4` (SURFACE),
`Split 1` (both studios), 9841 `Sketch 3` / `4`, d3cd9 `Sketch 7` / `8` +
`Extrude 8`, and their direct dependents.

#### Verdicts (updated)

- **Apply-time rematch containment:** **closed for the speculative path.** The
  authority to condemn a feature belongs only to the probes that build the apply
  sequence. This is what promoted 9841 `Shell 1` and `Extrude 2`.
- **X.5 (face-backed sketches):** **open**, no wiring landed. Its blocker moved
  again — from 9841 `Shell 1` to per-candidate face-signature matching against a
  live prefix that now genuinely exposes the owning body.

Validation: `bun run lint`, `bun run build`, `bun run test` (logic + UI + static),
and `bun run test:e2e` on a clean port 3123.

### Item-D follow-up: X.5 closes — face-backed sketches promote, and the start
plane binds to a durable entity

**Four 9841 face-backed sketches are parametric (`Cutter`, `Sketch 7`,
`Sketch 9`, `Sketch 10`), committed onto live faces through the durable
`topologyOf` sketch-plane support ref.** The blocker was neither a frame nor a
gate: it was **review matching more strictly than its own apply**.

#### The root cause, from per-candidate frames in the bake detail

The sketch-plane bake detail now prints the captured plane frame and box plus
those of every rejected live candidate. For 9841 `Sketch 2` against the
post-`Extrude 1` prefix:

| | origin (mm) | normal | box (mm) |
|---|---|---|---|
| captured `JI+` | `-7.5, 55.25, 95.6958` | `0, -0.866, 0.5` | `-67.5, 0, 0` .. `52.5, 110.5, 191.3916` |
| live `face_…g65dbcfc539ab43e4` | `52.5, 110.5, 191.3920` | `0, -0.866, 0.5` | `-67.5, 0, 0` .. `52.5, 110.5, 191.3920` |

Same plane, same box, same face — differing by **~4e-4 mm** of rebuild
precision. The reframe hypothesis was wrong: `Incline` is a `cPlane`, not a
transform, so no capture→world reframe exists or is needed, and the captured
signatures are already world-frame. What differed was the tolerance: the sketch
loop matched with `DEFAULT_MATCH_TOLERANCE` (`linear` 1e-4 mm) while the
apply-time `topologyOf` support ref it emits carries the live-topology tolerance
(`linear` 0.01 mm) that every other captured→live match in a review already
uses. Review rejected on `plane-offset` / `bounding-box` faces that apply would
have accepted.

#### The fix: one tolerance for every captured→live comparison

`LIVE_TOPOLOGY_MATCH_TOLERANCE` is now the single source for the sketch-plane
match, the emitted selector, the topology resolver, and checkpoint-body
selectors. No gate is relaxed, no candidate is matched by proximity, and
zero/one/many honesty is unchanged: coplanar-but-different faces are still
rejected (the nearest other candidate on `Sketch 2`'s plane is 25 mm away).
Sketch-plane promotion wiring (`probedFaceSelector` →
`SketchPlaneSupportRef`/`ImportDeferredTopologyRef` → apply-time rematch) already
existed; only the matching gate blocked it.

#### Cascade re-walk (9841 at the real browser gate; the rest at the real-OCC node review)

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 13 / 28 / 0 | **17 / 24 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** |

The upstream-edit proof is in the browser gate: the `walls` variable edit
rebuilds the committed timeline with zero snapshot diagnostics, so each promoted
sketch's support face rematches through the rebuild. The 9841 Playwright test
now takes 23.4 min (review cap raised to 3 000 000 ms, test timeout to
3 600 000 ms — wait caps only); the real-OCC node review of the same bundle
takes ~33 min.

9841 `Sketch 2` matched at review but its **apply-time** rematch failed
honestly: at apply its prefix presents a tessellation-backed checkpoint body
(`face_body_feature_extrude-1_t0008_*`), which exposes body identity only, so no
face of it can exist. It is contained at the feature level with a verbatim
detail, and `Extrude 3` cascades as `downstream-of-baked`. That is the same
checkpoint-replacement wall 5151's chamfers sit behind, not a matching question.

#### The edge-bound start extent

`ExtrudeStartExtent` gained an `entityOffset` form bound to a durable edge or
face, threaded exactly like the previous two extent contract extensions: a
`startEntity` topology slot resolved atomically against the exact pre-consumer
prefix, a deferred `topologyOf` selector in the prepared action, apply-time
rematch, and an OCC start plane resolved inside `runInRebuildSlot("extent", …)`
as the plane through the resolved entity perpendicular to the extrude direction.
Honesty rules, pinned in the logic lane with real OCC (`features.spec.ts`, seam:
`executeOccFeature` extrude): a face- or edge-bound start extent starts the prism
exactly on the entity's plane and sweeps the authored depth from there; an entity
that spans the direction names no single start plane and is refused rather than
resolved to one of its ends; an unresolved slot fails the plan instead of
starting on the profile plane (`extrude-planner.spec.ts`).

The capture evidence confirms the form: `Extrude 3`'s `startOffsetEntity`
(`KTqB`) resolves to a **planar face** (`normal 0, 0.866, -0.5`), and
`Extrude 15`/`16` (`KW9C`, `KzVB`) to **circular edges** whose axis is the
incline direction — all perpendicular to their extrude direction. All three
nevertheless stay baked, now behind their own upstream cascade
(`extrude-extent-topology-unresolved`, because the features producing those
entities are themselves baked) rather than `extrude-start-extent-unsupported`.
d3cd9 `Extrude 8` is the same class (its census `BLIND` label in earlier notes
was wrong: it is `ENTITY`), and it remains excluded scope behind `Sketch 7`/`8`.

#### Remaining bakes, classified

*Needs follow-up (each named):*
- 9841 `Sketch 2`, `Sketch 3`/`4`, `Sketch 5`/`6`: `Sketch 2` fails its
  apply-time rematch against a checkpoint body (above); the others still find no
  coplanar live face in their prefix, because the features that own their faces
  are baked.
- 9841 `Chamfer 3`/`4`, `Boolean 1`, `Delete part 1`: honest
  `topology-reference-no-match` against checkpoint bodies.
- 9841 `Extrude 3`/`15`/`16`, d3cd9 `Extrude 8`: entity-bound start extents whose
  producing features are baked (above).
- 5151 `Chamfer 1`/`2`: a bake checkpoint replaces their target body. 5151
  `Fillet 2`/`Chamfer 3`: honest `topology-reference-no-match`. 5151 `Extrude 4`:
  real kernel build failure; `Boolean 1`, `Extrude 3`/`6`/`7`/`8` cascade behind
  it.

*Honestly unresolvable with this capture set:* 9841 `Extrude 10`/`11` (BLIND
start offsets, no sign ground truth). **Superseded** — see "the BLIND start
offset, pinned against rollback ground truth" below: the capture does pin the
sign on both instances, and the two features are excluded-scope cascade now.

*Excluded scope (unchanged):* 9841 `Extrude 4` and d3cd9 `Extrude 4` (SURFACE),
`Split 1` (both studios), 9841 `Sketch 3`/`4`, d3cd9 `Sketch 7`/`8` +
`Extrude 8`, and their direct dependents.

#### Verdicts (updated)

- **X.5 (face-backed sketches):** **closed.** The wiring was already in place;
  the blocker was a review gate stricter than the apply gate it emits. Four 9841
  sketches are committed on live faces and survive an upstream edit. The
  remaining face sketches are blocked by baked owners or by checkpoint bodies,
  which are body-identity-only by construction.
- **Edge-bound start extent:** **contract closed, cascade open.** The form,
  resolution, apply rematch and kernel start plane are live and pinned against
  real OCC; every local instance is still waiting on an upstream promotion.

Reproducing the real-OCC node review: instantiate `OpenCascadeKernelAdapter`
over `public/cadara-occ.{js,wasm}` (the `loadRealOccForImportTest` pattern in
`apply-pipeline.spec.ts`), give **one** `createMemoryGeometryAssetStore` to both
`createImportCapabilities` and every probe service created by
`createKernelHistoryProbeSession` (a probe service without the shared asset store
reports `baked-body-assetMissing` and diverges from the browser), then call
`onshapeImportProvider.review` on the local bundle.

Validation: `bun run lint`, `bun run build`, `bun run test` (logic + UI +
static), and `bun run test:e2e` on a clean port 3123.

### Item-D follow-up: the BLIND start offset, pinned against rollback ground truth

**The BLIND start-offset sign convention is no longer a guess, and it is no
longer what bakes 9841 `Extrude 10` / `Extrude 11`.** Earlier notes recorded
"no sign ground truth here"; that was wrong. The capture does contain the ground
truth, in the rollback tessellation of the two features themselves.

#### Census of every BLIND start offset in the five root bundles

`jq` over every `extrude` feature in every Part Studio of all five roots
(`startOffset=true`), reading `startOffsetBound`, `startOffsetDistance`,
`startOffsetOppositeDirection`, `oppositeDirection`, `endBound`, `depth`:

| bundle / feature | bound | distance | startOffsetOpposite | oppositeDirection | endBound |
|---|---|---|---|---|---|
| 9841 `Extrude 10` (`FnqLWtKC5loyWcj_1`) | **BLIND** | `2 mm` | `true` | `true` | `UP_TO_SURFACE` (`JhK`) |
| 9841 `Extrude 11` (`FarVWY13vdeW4u9_1`) | **BLIND** | `#tolerance*2` (= 0.2 mm) | `false` | `false` | `UP_TO_BODY` (`JbD`) |
| 9841 `Extrude 1` / `3` / `15` / `16` | `ENTITY` | — | — | — | — |
| 5151 `Extrude 6` / `7` | `ENTITY` | — | — | — | — |
| d3cd9 `Extrude 8` | `ENTITY` | — | — | — | — |
| `405fa…`, `40a51…` | *no `startOffset` extrude at all* | | | | |

So the BLIND form has exactly two instances in the whole local set, both in
9841. Nothing else had to be re-checked.

#### The evidence arithmetic

Project the rollback tessellation onto the incline direction
`u = (0, 0.8660254037844385, -0.5000000000000004)` (the exact `definingData.normal`
of the captured `JhK` plane) and diff the per-face bounding boxes across the
snapshot pair that brackets each feature. Tessellation noise is ≤ 7e-6 mm.

| | `Extrude 10` (snapshots 17 → 18, body `JbH`) | `Extrude 11` (snapshots 18 → 19, body `JbD`) |
|---|---|---|
| profile plane | `Sketch 7` (`FH6MWczB8BMDAEB_1`): `sketchMatrix` normal `-u` through the origin ⇒ **u = 0** | `Extrude 10`'s end cap (`CAP_FACE`, `isStart=F`), i.e. the `JhK` plane ⇒ **u = 17.000000 mm** |
| extrude direction | sketch normal `-u`, `oppositeDirection=true` ⇒ **+u** | face normal `+u`, `oppositeDirection=false` ⇒ **+u** |
| added start caps (facet normal `-u`) | 6 faces, all at **u = +2.000000 mm** | 6 faces, all at **u = +17.200000 mm** |
| added end caps (facet normal `+u`) | 6 faces, all at u = 17.000000 mm (= the `UP_TO_SURFACE` plane) | terminated on `JbD` |
| ⇒ start-plane displacement | **+2.000 mm along the extrude direction** = authored `2 mm` | **+0.200 mm along the extrude direction** = authored `#tolerance*2` |

The independent cross-check is that the two instances carry *different* flag
values (`true/true` and `false/false`) and *different* distances (a literal and
a variable expression), yet both displace by `+distance` along the extrude
direction. `Extrude 11` corroborates `Extrude 10` a second way: its own profile
plane is `Extrude 10`'s end cap, which the arithmetic above independently places
at u = 17.000000 mm.

#### What is pinned, and what is deliberately still refused

Both instances have `startOffsetOppositeDirection === oppositeDirection`. That is
the whole of what the capture set discriminates. For that combination the answer
is measured, not inferred: the contract's `blindOffset.direction` is signed along
the extrude direction (`resolveStartExtentOffset` receives the already-flipped
direction), so the importer emits `direction: "positive"` with the authored
distance.

When the two flags disagree the data cannot separate "offset along the un-flipped
profile normal, negated by `startOffsetOppositeDirection`" from "offset always
along the extrude direction" — the two conventions consistent with both
instances. That combination therefore keeps baking with
`extrude-start-extent-unsupported`, as do symmetric and two-sided extents, for
which a single start plane is not defined. No sign was guessed.

A second, previously unexercised gap had to close for `Extrude 11`: its authored
distance is the variable expression `#tolerance*2`. The start offset is now one
of the extrude's resolved expression fields, and normalization rejects only a
non-positive *literal*, exactly like the blind end distance. The authored
variable linkage is preserved rather than substituted with the captured value.

#### Cascade re-walk (9841 at the real browser gate, clean port 3123)

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 17 / 24 / 0 | **17 / 24 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **16 / 8 / 0** |

Tier counts do not move, and are reported as such rather than tuned. The change
is in the two features' reasons:

| Feature | Before | After |
|---|---|---|
| 9841 `Extrude 10` | `extrude-start-extent-unsupported` | `extrude-extent-topology-unresolved` |
| 9841 `Extrude 11` | `extrude-start-extent-unsupported` | `extrude-extent-topology-unresolved` |

Neither promotes, and the remaining blocker is not the start plane. Both name
their own terminator and boolean scope: `Extrude 10` needs `UP_TO_SURFACE` face
`JhK` plus scope `JbH`, and `Extrude 11` needs `UP_TO_BODY` / scope `JbD`. `JbH`
and `JbD` are outputs of `Split 1`, which is excluded scope, so these two now sit
in exactly the same cascade as `Extrude 3` / `15` / `16`. The `walls` rebuild
still passes with zero snapshot diagnostics and the committed timeline is
unchanged, so nothing regressed.

Because the two real features never build, their prisms cannot be compared
against the snapshot bounding boxes at the kernel; that is honestly out of reach
until the excluded `Split 1` cascade opens. What is pinned instead: the kernel
sign semantics against real OCC (`features.spec.ts`, seam `executeOccFeature`
extrude — all four combinations of end direction × start-offset direction land
the prism on the exact expected planes to 1e-6), the planner mapping and its
refusal of the undiscriminated combination (`extrude-planner.spec.ts`, seam
`planExtrudeFeature`), and the derivation's premises against the real bundle
(same file, skipped when the gitignored bundle is absent).

#### Verdicts (updated)

- **BLIND start extent:** **convention pinned, cascade open.** The sign is
  measured from rollback ground truth on both local instances; the
  undiscriminated flag combination stays refused. `Extrude 10` / `11` are no
  longer listed as "honestly unresolvable" — they are ordinary excluded-scope
  cascade now.

Validation: `bun run lint`, `bun run build`, and `bun run test:all` on a clean
port 3123.

### Item-D follow-up: surface bodies land — d3cd9's SURFACE/Split cascade opens, 9841's does not

**The three gaps that kept `Extrude 4` and `Split 1` out of scope are closed at
the kernel and at the importer; only one of the two real instances promotes.**
The surface substrate (`resultBodyType` extrude/revolve/thicken contract, open
sketch-curve wire profiles, sheet-body tracking), the sheet-tool split
(`BRepAlgoAPI_Splitter` bound into the custom build plus a `runSheetSplit`
JavaScript fallback), and the Onshape `SURFACE` extrude translation all landed.

#### Cascade re-walk (real browser gate, clean port 3123)

| Studio | Before | After |
|---|---:|---:|
| Mounts `40a51…` | 10 / 0 / 0 | **10 / 0 / 0** |
| Wave-T (all six studios) | all parametric | **all parametric** |
| Laptop Stand `5151…` | 11 / 13 / 0 | **11 / 13 / 0** |
| Part Studio 1 `9841…` | 17 / 24 / 0 | **17 / 24 / 0** |
| Part Studio 1 `d3cd9…` | 16 / 8 / 0 | **18 / 6 / 0** |

d3cd9 `Extrude 4` (SURFACE, BLIND, `symmetric`) and `Split 1` (solid target,
sheet tool, `keepTools=false`) are both committed parametrically, and the sheet
reaches the timeline as `feature_extrude-4` followed by `feature_split-1`.

Two premises had to be measured, not assumed. Onshape distributes a `symmetric`
depth evenly while cadara's symmetric extent applies its end distance in *both*
directions, so the authored depth is halved: d3cd9 `Extrude 4` authors
`depth = 50 mm, symmetric = true` and its rollback sheet spans
z ∈ [−25 mm, +25 mm]. The same flag also corrects three previously mistranslated
solid extrudes (d3cd9 `Extrude 2`/`3`/`5`, 5151 `Extrude 4`), which carried
`symmetric = true` under a non-`SYMMETRIC` `endBound` and were being planned
one-sided.

#### 9841 `Extrude 4`: the blocker moved from the body type to its own terminator

`Extrude 4` now plans as a surface extrude, resolves its whole-sketch wire query
(`qConstructionFilter(qBodyType(qCreatedBy("FPdEtb3tuGCfOlr_1", EDGE), WIRE), NO)`)
to the two open segments of that sketch, and reaches the kernel. It is refused
there, verbatim:

```
Extrude 4 | feature-kernel-build-failed |
kernel-history-probe-step-failed: History probe failed at step 14:
occ-topology-deleted: Extrude 4 end condition target is incorrect.
[refused target face face_body_feature_extrude-1_t0010_6]
```

So the `UP_TO_SURFACE` terminator (captured face `JQm`) does resolve to a live
face of `body_feature_extrude-1`, but that face is invalidated with
`occ-topology-deleted` by the time the probe replays the feature. The next root
cause is that invalidation's lineage across `Chamfer 2` / `Shell 1` / `Extrude 2`
— not the surface path, the profile chain, or the split tool. `Split 1` follows
one step behind with `topology-history-evidence-missing` (`No Cadara topology
matches JaD.`), because its tool body is exactly the sheet `Extrude 4` never
built. Every downstream consumer (`Extrude 5`/`6`/`12`/`13`/`14`/`15`/`16`,
`Sketch 3`/`4`) quotes that same step-14 failure, so 9841 has one blocker, not
nine. The e2e pin now names `Extrude 4`'s moved reason instead of leaving it
unasserted.

#### d3cd9's next blocker, named

With the split committed, `Sketch 7` / `8` are the frontier and they fail
honestly on many, not zero:

```
Sketch 7 | needs-history-probe | matched 2 live faces, none uniquely:
face_body_feature_split-1_split_2_gb3f0a7f5dede8557 |
face_body_feature_split-1_split_4_gb3f0a7f5dede8557
```

A split leaves the two pieces sharing a coincident face, so a purely geometric
signature cannot separate them; Onshape's query names the face *of a specific
body*. Resolving it needs body-scoped candidate filtering for split outputs, not
a tolerance change or a nearest-candidate pick. `Extrude 5`/`6`/`7` cascade
behind those two sketches, and `Extrude 8` stays
`extrude-extent-topology-unresolved`.

#### Verdicts

- **Kernel open-curve surface extrude:** **closed.** Real-OCC pins in
  `features.spec.ts` (seam `executeOccFeature`) prove a wire profile sweeps to a
  `bodyKind: "sheet"` body, that a sheet is refused by solid-only paths
  (fillet/boolean), and that thicken turns it back into a solid.
- **Sheet-tool split:** **closed.** The native shim branches on the tool's
  `ShapeType()` into `BRepAlgoAPI_Splitter` with the same history payload, and
  the JavaScript fallback mirrors it; both are pinned in
  `combine-split-delete.spec.ts` against the custom build. Split outputs keep
  riding the existing fresh `body_<feature>_split_N` identities with
  split-ambiguous invalidations — no source-id guessing, matching Onshape, which
  also mints fresh ids for the pieces.
- **Importer SURFACE translation:** **closed for `NEW` surface extrudes.**
  Non-`NEW` surface operations, authored draft, and unreadable/branching profile
  queries bake with their own reason codes.
- **The 9841 SURFACE→Split cascade:** **open.** The then-current
  `occ-topology-deleted` refusal is superseded by the second follow-up below; the
  surface target is now live, but an earlier profile/region checkpoint remains.

Validation: `bun run test:all` on a clean port 3123.


### Item-D second follow-up: shell lineage and split-face ownership

The two blockers named above were re-walked through the real browser worker and
custom OCC build.

#### 9841: the `JQm` / `t0010_6` invalidation is closed

The loss occurred at `Shell 1`, not at `Extrude 2`. Whole-body shell modes used
`trackReplacementSolidBody` plus an unsupported producer stage, discarding the
OCC offset builder's exact `Modified` / `Generated` history. Every replay then
minted positional `tNNNN_*` face ids; `Extrude 2` correctly reported the old
`t0010_6` face deleted because Shell had already severed its lineage.

Whole-body shell replacement now reconciles through the builder's own history
and emits the same exact local-operation topology stage used by fillet/chamfer.
The 13 surviving outer faces retain their existing generated ids through Shell;
only subtopology the builder cannot name remains unsupported. The real 9841
prefix consequently builds `Extrude 4` and `Split 1` when isolated: the surface
extrude's `UP_TO_SURFACE` target is no longer refused.

The complete studio does not promote those two yet. Reaching this deeper prefix
exposes an earlier failure that the old surface refusal masked: `Sketch 2` /
`Extrude 3` cannot materialize their live profile region. Their checkpoint is
body-only, so `Cutter` cannot recover its supporting face; `Extrude 4` is then
honestly `downstream-of-baked`, and `Split 1` cannot resolve sheet `JaD`. This is
now a profile/region checkpoint frontier, not a surface, sheet-split, or shell
lineage defect. The honest browser tier is **16 / 25 / 0** (previously
17 / 24 / 0 because the masked prefix failure had not been contained).

#### d3cd9: one coincident split face is exactly body-scoped

The rollback snapshot records which captured split body owns each support face.
Available sibling faces with an exact unique live match vote for that match's
live body; scoping occurs only when at least one such vote exists and all unique
votes agree on one live body. Non-matching or non-unique siblings do not
fabricate a vote. More than one admissible candidate is always ambiguous—body
attribution disables the ordinary score-margin winner—so this cannot become
nearest-geometry matching. The proven live `BodyId` is carried on the deferred
selector and applied as the same hard scope during commit; an empty scoped set
stays no-match.

That promotes `Sketch 7`, moving d3cd9 from **18 / 6 / 0** to **19 / 5 / 0**.
`Extrude 5` and `Extrude 6` now reach their own next blocker: their deferred
region selector does not resolve in committed Sketch 7, so each is contained as
`feature-kernel-build-failed` with the raw `regionOf` diagnostic. `Sketch 8`
stays behind those baked cuts and cannot recover its support face from the
body-only checkpoint; `Extrude 7` cascades, and `Extrude 8` remains an unresolved
live-topology extent. The `screwHole` upstream rebuild still passes with zero
snapshot diagnostics.

Probe action/materialization exceptions are now converted to a failed feature
step with their original message; structured topology-rematch exceptions still
bubble to their dedicated consumer-prefix containment path. This prevents a
newly reachable profile failure from aborting the entire studio.

Validation: focused modeling/import/contracts tests, lint, build, 9841 `walls`
rebuild, and d3cd9 `screwHole` rebuild passed on clean port 3123. The final
acceptance components are green: 705 logic, 126 UI, 27 static, 56 fast Playwright,
and 14 serial real-capture Playwright tests.

### Latest verification: d3cd9 region identity and native sheet-split boundary

The real browser gate moved d3cd9 from **19 / 5 / 0** to **23 / 1 / 0**
(parametric / baked / geometryOnly). `Extrude 5`, `Extrude 6`, `Sketch 8`, and
`Extrude 7` promoted through a transient importer-only, orientation-stable exact
region-boundary identity. Persisted `RegionId` semantics were restored and remain
unchanged.

`Extrude 8` now resolves its topology face/body slots and grouped `(25/2) mm`
depth. It remains the sole bake: `Split 1`'s native sheet-split transaction
publishes no exact tool-face `Modified` successor/producer stage, so the
correctly matched JZa face is invalidated during replay with
`occ-topology-unsupported-history`.

The attempted JavaScript `Generated(toolFace)` bypass was removed. The native
path is retained; no geometry or topology match was fabricated. The correct
**24 / 0 / 0** follow-up requires a native split-history payload carrying tool
face `Modified` history to the exact final face and stable output slot, followed
by a WASM rebuild. That rebuild is unavailable in this environment because no
working container/emcc toolchain is available.

The d3 E2E now pins **23 / 1 / 0**, the exact timeline, zero diagnostics, the
`screwHole` rebuild, and no alerts; its single test passed in **33m22.693s**.
Final `bun run test:all` validation is green: **719 logic**, **126 UI**, **27
static**, and **56 fast Playwright** tests passed. Surface-extrude support remains
landed and is not an exclusion.

### Session note: the sheet-split wasm rebuild landed, and the 24/0 blocker moved into the boolean shim's history coverage

The previous note's claim that the tool-history wasm rebuild "is unavailable in
this environment" is superseded: the shim entry point
(`BuildSheetSplitCommittedShapeTransactionWithToolHistory`) was rebuilt into
`public/cadara-occ.wasm` and `OCC_ASSET_VERSION` now records the shipped asset
hashes. Exercising that path end-to-end against the real d3cd9 capture exposed
two provenance defects and one honest kernel boundary, worked in order:

1. **Same-feature source-key convergence was mis-handled.** `Extrude 3`'s
   symmetric halves both claim one fused lateral face
   (`…symmetric-first-end…generated-side-face` and
   `…symmetric-second-end…generated-side-face`), which first resolved
   `occ-topology-provenance-ambiguous` and failed `Split 1` outright (17/24).
   The provenance index now dedupes identical `(feature, sourceKey, target)`
   claims and resolves supported same-feature multi-source convergence to a
   deterministic sorted `composite:` canonical id; any unsupported participant
   keeps the target fail-closed as missing. Cross-feature ambiguity is
   unchanged. Pinned in `topology-stage.spec.ts` under both insertion orders.
2. **Exclusive-witness translation failures must degrade, not abort.** With the
   composite in place, one sheet-split output slot still has zero resolvable
   witnesses, so `executeSplitFeature` now degrades exactly that structured
   failure class down the existing ladder (tool-history → generic native → JS)
   with a `occ-native-sheet-split-tool-history-degraded` warning diagnostic,
   restoring the honest 23/1 instead of failing the studio to 17/24. Pinned
   against the real custom build in `combine-split-delete.spec.ts`.
3. **The remaining 24/0 boundary is native, not JS.** The unresolvable
   witnesses are positional reminted faces (`t0019_15`, `t0019_25`/`t0016_16`,
   `t0019_26` on `body_feature_extrude-1`): the native boolean's
   `HistoryJson()` genuinely returns no record for one of them at `Mirror 1`'s
   join (`t0018 → t0019`), and the roots were already positional at
   `Extrude 3`'s join (`t0016`). No geometry or traversal match was fabricated.
   Closing this requires extending the shim's committed-shape history coverage
   (`CadaraPrepareCommittedShapeWithHistory` / boolean face records) followed by
   another wasm rebuild.

Cleanup in the same session: the `CADARA_TRACE_D3_SPLIT_PROVENANCE` debug
scaffolding was removed from `combine-split-delete.ts`, `mirror-transform.ts`,
and `provider.spec.ts`; the dead "older probe implementation" rematch-catch
compat path (and its contract-violating pinned test) was removed from
`topology-resolution-planner.ts`; mirror-add operand collection no longer
swallows arbitrary exceptions — per-face skips are limited to structured
`occ-topology-provenance-*` outcomes via `isOccTopologyProvenanceResolutionError`
and genuine faults propagate.

The d3 real-OCC review gate (`provider.spec.ts`) now pins 23 parametric with
`Extrude 8` as the only bake and `Split 1` parametric through the degraded
generic sheet split.
