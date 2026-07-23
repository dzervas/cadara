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
acceptance goal: every supported feature in every root
`*.onshape-capture.json` imports as live parametric history. Phase X supersedes
mock-review tier counts as acceptance. The real browser/worker/OCC apply path is
the gate; `scripts/onshape-plan-dump.ts --review` remains diagnostic only because
it echoes captured signatures and does not rebuild OCC geometry.

Scope and denominator:

- Root bundles: `405fa226bb150016d09afc09`, `40a51fb8fa82fd4565151114`,
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
- [ ] X.3 **Refresh local capture evidence.** Target-enrich all five root bundles
      with the current exact-profile evidence schema. Reuse immutable source,
      deterministic-ID, query-resolution, final-geometry, and existing boundary
      evidence when its document microversion and element match; request only
      missing opaque-profile states and proven bake-boundary geometry. Verify format
      v2, the current complete profile-evidence manifest, expected
      `resolvedQueryReferences`, and boundary-only rollback coverage; do not commit
      root capture files. No compatibility fallback for pre-X.4 evidence is permitted.


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

      Local planar subdivision emits every bounded nested cell with immediate-child
      holes, analytically splits line/arc/circle intersections, uses curve-aware
      containment, and preserves stable source/split provenance. OCC reconstruction
      rebuilds bounded split circles and arcs as open arcs and preserves synthetic
      endpoints and split ordinals. Synthetic and real-OCC regressions cover selected
      subsets, nested regions, mirror-derived witnesses, mixed curves, and ambiguous
      evidence.

      Current logic-lane review counts are: Wave T `405` **2/0/0**, Mounts `40a51`
      **10/0/0**, Laptop Stand `5151` **23/1/0**, PS1 `9841` **30/11/0**, and `d3cd9`
      **23/1/0**. These are diagnostic, not acceptance. In `9841`, four supported
      extrudes (`Extrude 5`, `6`, `16`, and `15`) still report
      `needs-region-resolution`; any downstream sketch/topology fallout must be
      re-evaluated in source order after each profile producer becomes live. X.4 closes
      only when every non-surface solid extrude resolves its exact selected cell and
      applies through the real browser/OCC seam.
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
  - [ ] X.9.2 **Close residual exact-topology ambiguity.** Resolve, without tolerance
        relaxation or nearest-geometry selection, Laptop Stand 5151 `Boolean 1` and
        the currently diagnostic 9841 residuals `Chamfer 2`, `Extrude 12`, and
        `Extrude 10`. Use consumer-time signatures, exact ownership/adjacency, and
        source-ordered live prefix lineage. Re-run after each preceding region or
        face-sketch producer promotes so cascade failures are not mistaken for four
        independent matcher defects. Preserve zero/one/many honesty and never
        fabricate `owningFeatureId`.
  - [ ] X.9.3 **Make probe and large-bundle failures observable and stable.** Preserve
        the first failed kernel-probe diagnostic instead of collapsing every failed
        prefix to `topology-history-evidence-missing`. The shared Playwright import
        helper must distinguish a visible review error from a timeout and reliably
        load/review/commit the 227 MB `9841` bundle without ad hoc harnesses or stale
        Typia/HMR compatibility bypasses. Diagnose performance or worker composition;
        do not merely inflate every unrelated wait.
  - [ ] X.9.4 **Complete the real-browser acceptance matrix.** Extend the shared
        Playwright Onshape harness, not ad hoc scripts, to cover every studio in all
        five root bundles. Assert the exact non-surface feature timeline, zero
        baked/checkpoint actions, zero suppressed supported features, zero
        invalid-reference diagnostics, and at least one meaningful upstream
        edit/rebuild per studio. Tests skip only when a gitignored bundle is absent.
- [ ] X.10 **Final verification and cleanup.** Run `bun run test:all`, record exact
      final tier tables here, remove temporary capture/debug code and stale
      mock/browser baselines, and verify `jj status` contains only intentional
      committed work. Phase X is complete only when X.1–X.9.4 and the full suite
      are green; no scoped-complete wording may hide residual supported bakes.

Full-parametric math: Mounts = W.2 + W.3. Part Studio 1 = W.1 + W.2 + W.4,
with W.5 now covering future non-hollow empty-shell forms but not PS1's true
closed-hollow Shell 1. Highest leverage first: W.1.

Session notes for the next orchestrator: subagent model routing —
`dzerv-art/gpt-5.6-sol` had a multi-day quota cooldown (check before use),
`openai-codex/gpt-5.6-sol` quota was reset 2026-07-18, Claude models work as
fallback; always pass fully-qualified model names to workflow agents (fuzzy
resolution picked a keyless openrouter provider once). Real bundles + the
`.cadara` capture in repo root are gitignored local fixtures. jj commits with
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
- Never commit `*.onshape-capture.json` (gitignored) or print `.envrc`
  contents. API creds come from the environment (`direnv` or
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
