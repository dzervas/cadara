# Onshape baked-history segments

## Status and scope

This document designs item B.1 of `docs/onshape-importer-completion-plan.md`.
It replaces first-bake poisoning for snapshot-enabled Onshape captures with
interleaved baked-body checkpoints. It is a design for B.2 (planning) and B.3
(provider/orchestrator emission); it does not implement either item.

The safety rule is:

> A baked run may stop poisoning later history only when Cadara can materialize
> the exact captured post-run body state, identify every checkpoint body needed
> by a later consumer without guessing, and explicitly remove every earlier body
> output represented by the checkpoint.

If any of those conditions is unavailable at a required segment boundary, the
studio uses the existing whole-studio final-state bake path. Snapshot absence
must never produce a new partially segmented behavior.

This design covers body-level continuation across baked checkpoints. It does not
claim face or edge topology on a baked mesh.

## Repository findings that constrain the design

### First-bake poisoning is split between translators and the studio plan

`FidelityPlanningState.bakedLineageFeatureIds` is written by the sketch,
extrude, Wave A, Wave B, and fallback translators. Region consumers consult the
set directly; for example, `extrude-feature-translator.ts` changes a downstream
extrude to `target: suppressed` and adds `downstream-of-baked` when its sketch or
boolean source feature is present in the set.

`planStudioFidelity()` then derives `requiresStudioBake` from whether that set is
non-empty. `buildPreparedActions()` skips every non-parametric feature and, at
the end of the action sequence, appends one `bakedBody` from final
`groundTruth.tessellatedFaces`. Its `replaceBodyOutputs` scope names all earlier
ordered `createFeature` positions. The result is intentionally honest for v1
captures but unnecessarily suppresses later eligible history when v2 rollback
snapshots exist.

Provider review currently recomputes `requiresStudioBake` as “any baked feature
and the studio has bodies,” so probe-backed promotions still retain the same
whole-studio behavior.

### The rollback timeline already carries the required source evidence

Each v2 `OnshapeRollbackSnapshot` is the state after its named feature and
contains:

- the complete tessellated body list with Onshape body and face IDs;
- an optional STEP export;
- a tessellation tolerance.

`rollback-topology-reader.ts` already provides `snapshotBeforeFeature()`,
`snapshotAfterFeature()`, and `featuresModifyingBody()`. The 2026-07-16 audit
used that timeline to show that Part Studio 1's Boolean 1, Delete part 1, and
Split 1 were blocked because their bodies were shaped only by baked upstream
features. That attribution remains useful, but “modified by a baked feature” no
longer means “unreachable”: after B.3 it can mean “available from a checkpoint.”

`rollback-bake.ts` already converts a post-feature tessellation into a partitioned
`baked-mesh` asset and prepares a deferred `replaceBodyOutputs` request. Today it
is used only as a topology consumer's apply-time fallback and encodes component
keys by body array index rather than Onshape body ID.

### A checkpoint is a real body producer, but only at body level

`bakedBody` materialization creates one durable body per declared baked-mesh
component, in component order. Those bodies retain OCC solid shapes and can be
used by body-level operations such as combine, delete, split, transform, and
boolean-scoped extrude/revolve. They deliberately use
`topologyPresentation: "bodyOnlyMesh"`, expose no face/edge/vertex IDs, and skip
native topology naming.

Consequences:

- a checkpoint can unblock a body query;
- it cannot directly unblock a fillet, chamfer, shell face, thicken face, or a
  genuinely face-attached sketch;
- a face-backed sketch may promote only by using an honest captured world-space
  frame and a generated explicit-frame construction plane. It must not pretend
  that the checkpoint mesh has a durable source face.

The kernel history probe currently asks every body for an exact B-rep payload and
fails when one is unavailable. `ImportDeferredMaterializer` is more permissive:
it already synthesizes a body signature from render-mesh bounds when no exact
body signature exists. B.3 must share that body-signature path with the history
probe so checkpoint bodies can participate in exact-prefix review without
exposing fabricated subtopology.

### Deferred action indexes are ordered positions

`ImportDeferredValue.actionIndex` and
`ImportDeferredBakedBodyReplacement.actionIndexes` refer to positions in
`orderedActions`, not indexes in `createFeatures`. Validation requires every
replacement position to name an earlier ordered `createFeature` action.

At apply time, output records are keyed by ordered position. `bodyOf` currently
returns the first body produced by the referenced action; `topologyOf` rematches a
captured signature against the current live document immediately before the
consumer. A topology fallback replaces the consumer request at the same ordered
position, so later references naturally see the fallback checkpoint's outputs.

The “first body” behavior is safe only for a producer known to have exactly one
body output. Segment planning must never use `bodyOf` for an unattributed
multi-body checkpoint.

### `replaceBodyOutputs` is intentionally coarse

At prepare time a baked checkpoint names producing actions, not individual body
slots. At apply time the materializer collects all body IDs recorded for each
named action and converts the request to canonical `replaceBodies`.

Therefore, if a checkpoint consumes one body from an action that produced
multiple still-live bodies, it must also carry the untouched sibling bodies
forward. Otherwise naming that producer action would delete bodies that the
checkpoint asset did not reproduce. This replacement closure is a planner
invariant, not something the materializer should infer from geometry.

## Design decisions

### 1. Make bake strategy explicit and keep legacy mode intact

`StudioPlan` gains a bake-strategy discriminant rather than deriving behavior
from “any baked feature”:

```ts
type StudioBakeStrategy =
  | { kind: "none" }
  | { kind: "segments"; segments: readonly BakeSegmentPlan[] }
  | {
      kind: "wholeStudioLegacy";
      reason:
        | "capture-v1"
        | "rollback-snapshots-absent"
        | "history-probe-unavailable"
        | "segment-preflight-failed";
    };
```

`requiresStudioBake` may remain temporarily as a derived compatibility field,
but it is `true` only for `wholeStudioLegacy`. A studio may contain baked feature
rows and segment checkpoints while `requiresStudioBake === false`.

The current v1/no-snapshot planner and final-ground-truth provider branch remain
an explicit legacy path. B.2 must not approximate that path by running the new
planner with empty segment data. Legacy mode retains the same:

- feature tiers and suppression cascade;
- `downstream-of-baked` behavior;
- final-state ground-truth bake;
- replacement of all prior imported feature body outputs;
- prepared action order.

A snapshot-enabled studio enters segmented mode only after all required segment
boundaries pass preflight. User demotions are planning inputs: prepare must
recompute segments with the selected demotions instead of merely skipping a
previously parametric action.

**Rationale:** an explicit strategy prevents future code from accidentally
reintroducing `requiresStudioBake = featurePlans.some(baked)` and makes “no
behavior change without snapshots” testable as a branch invariant.

### 2. Segment body history, with neutral features attached to the surrounding run

Segmentation is about changes to the Part Studio body state, not a simple grouping
of adjacent feature-tier strings.

```ts
interface BakeSegmentPlan {
  segmentId: string;
  fromFeatureId: string;
  toFeatureId: string;
  featureIds: readonly string[];
  boundaryFeatureId: string;
  checkpointBodyDeterministicIds: readonly string[];
  directlyAffectedBodyDeterministicIds: readonly string[];
  consumedBodyDeterministicIds: readonly string[];
  carriedBodyDeterministicIds: readonly string[];
  replacementProducerFeatureIds: readonly string[];
  bodyBindings: readonly CheckpointBodyBinding[];
}

interface CheckpointBodyBinding {
  deterministicId: string;
  sourceComponentKey: string;
  capturedSignature: OnshapeGeometricSignature;
}
```

The planner first separates a feature's **intrinsic translation result** from
whether its dependencies are reachable. Translators may still report an
unsupported parameter or missing region/profile, but they no longer mutate one
global baked-lineage set.

The sequential walk maintains:

- reachable sketches and constructions;
- current Onshape body deterministic ID -> parametric producer or checkpoint
  producer;
- the current parametric prepared-action prefix;
- at most one open baked run.

A body-changing feature enters a parametric run when its intrinsic translation is
eligible and all required inputs are reachable from that prefix. Otherwise it is
added to the open baked run. Before the next parametric body-changing feature is
emitted, the baked run closes and contributes exactly one virtual checkpoint at
the post-state of its last body-changing feature. Planning then continues with
that checkpoint as a normal body producer.

Multiple consecutive unsupported/body-blocked features therefore collapse into
one checkpoint from the rollback snapshot of the run's last feature. The
checkpoint's provenance span is the first feature whose unrepresented dependency
belongs to the run through that boundary feature.

In this document, the "last feature of the baked run" is exactly
`boundaryFeatureId`: the final baked/body-blocked feature represented by the
checkpoint snapshot. Neutral pass-through entries may occur between run members
in source order, but they are associated for presentation only and do not become
the snapshot boundary.

Neutral history entries are handled as follows:

- **Source-suppressed features** do not change captured body state, do not open or
  extend a baked run, and do not poison reachability. They remain visible as
  suppressed review rows and produce no checkpoint solely because they exist.
- **Variables** are pass-through parametric actions. They may appear inside the
  source span of a baked run because they do not change bodies. Their action stays
  in source order before the eventual checkpoint.
- **Parametric sketches and planes** are also pass-through when independent of the
  open run. If they consume a body/face state produced by the run, the checkpoint
  must be inserted before them.
- **Baked sketches or planes** do not by themselves justify a body checkpoint.
  If a later solid depends on them and cannot translate, both belong to the baked
  run whose last body-changing feature supplies the snapshot. If no later body
  state captures their effect, they remain diagnostic-only baked rows.
- **Unsupported metadata or features that produce no bodies** do not force a
  checkpoint unless the rollback body delta proves that they changed body state.

A parametric body-changing feature always splits baked runs. It cannot be emitted
“through” a pending checkpoint because doing so would reverse source body-history
order.

**Rationale:** this retains one checkpoint per actual body-state barrier without
creating meaningless mesh features for variables, sketches, planes, or suppressed
entries.

### 3. Derive a selective checkpoint body delta, then close over replacement actions

A rollback snapshot is a complete studio state, but a segment checkpoint should
not automatically rebake every independent body branch.

For a run with first body-changing feature `Fstart` and boundary `Fend`, compare:

- the nearest valid body snapshot before `Fstart`; and
- the exact `snapshotAfterFeature(Fend)`.

Bodies are compared by deterministic ID plus their rollback tessellation shape
key. The direct delta is:

- **introduced:** absent before, present after;
- **changed:** present in both with different captured tessellation;
- **removed:** present before, absent after.

Introduced and changed bodies are initial checkpoint outputs. Changed and removed
bodies are initial consumed bodies. A changed body with the same Onshape ID is
both consumed and reproduced.

`replaceBodyOutputs` operates at action granularity, so the planner computes a
replacement closure:

1. Find the current producer action for every consumed body.
2. Add each producer to `replacementProducerFeatureIds`.
3. Add every other still-live body produced by those actions to
   `carriedBodyDeterministicIds` and the checkpoint output set.
4. Repeat if a carried/replaced body belongs to an earlier multi-body checkpoint
   whose other live outputs must also be retained.

The final checkpoint asset contains:

- introduced/changed segment outputs; and
- unchanged sibling bodies carried only because their producer action is being
  replaced.

The checkpoint replacement names only the closed producer-action set. Unrelated
live body producers are neither replaced nor duplicated.

Example: if an earlier checkpoint action produced bodies `A` and `B`, and the new
baked run changes only `A`, the new checkpoint replaces the earlier checkpoint
action and contains changed `A` plus carried `B`. It does not append another `A`
while leaving the old action live.

If the planner cannot establish the before-state, exact after-state, current body
producer, or replacement closure, it must not emit a selective checkpoint. The
studio falls back to `wholeStudioLegacy` with a segment preflight diagnostic.

A deletion-only run whose replacement closure has no resulting body cannot be
represented by today's non-empty baked-mesh `bakedBody`. Until a replacement-only
checkpoint contract exists, such a run also falls back to the legacy path. This
is not a reason to guess by carrying an unrelated body.

**Rationale:** selective deltas preserve independent parametric branches, while
the closure makes the existing action-level replacement contract exact and avoids
double representation.

### 4. Preserve source body identity through component keys and signature matching

`encodeOnshapeTessellationAsBakedMeshBytes()` changes its component key from
`onshape-tessellation-body-${index}` to a stable key containing the source body
ID, for example `onshape-body:JHD`. The encoded component order continues to
follow the rollback snapshot body order, but correctness does not rely on that
order.

For every checkpoint output body the planner derives a normalized body signature
from that body's facets: entity class, body geometry family, bounding box,
centroid, bounded tessellation sample, and capture tolerance. The checkpoint
binding table records the deterministic ID, source component key, and signature.

A downstream body query resolves in three steps:

1. **Source attribution.** The deterministic ID is found by exact equality in the
   pre-consumer rollback snapshot. This selects one checkpoint binding; no STEP
   subshape order is used.
2. **Exact-prefix review.** The checkpoint action is present in the sandboxed
   prepared-action prefix. The history probe derives body signatures from native
   exact payloads for parametric bodies and render-mesh bounds for `bodyOnlyMesh`
   checkpoint bodies. The existing non-guessing signature matcher must return one
   unique body.
3. **Apply-time rematch.** The same `topologyOf` captured signature is matched
   against the real live document immediately before the consumer. The stored
   authored request receives the live `BodyRef`, never a sandbox ID or an Onshape
   deterministic ID.

When a producer action is proved to have exactly one live body output, a deferred
`bodyOf` may point directly at that checkpoint's ordered action position. This is
the normal Mounts Transform 1 -> Extrude 2 boolean-scope case. The materializer
must require exactly one body output rather than silently selecting the first.

When a checkpoint has multiple bodies, deterministic body queries use
`topologyOf`; they do not use unqualified `bodyOf`. Query bindings are all-or-
nothing and injective: two source IDs may not bind to the same live body.
Coincident or signature-equivalent checkpoint bodies remain ambiguous and keep
the consumer baked. Component array order is never a tie-breaker.

Face/edge/vertex queries do not match against checkpoint mesh bodies. Their
candidate set contains body identity only. Subtopology consumers remain governed
by the durable-naming design and by whether a native parametric body supplies the
required topology.

**Rationale:** exact source IDs establish which captured body is intended;
signatures establish which Cadara body currently represents it. Keeping those
roles separate avoids both index coupling and nearest-looking guesses.

### 5. Treat a checkpoint as the authoritative post-run body state

At apply time the baked checkpoint request is materialized as follows:

1. Resolve its `replaceBodyOutputs` ordered positions to concrete body IDs from
   prior output records.
2. Create the `bakedBody` with canonical `replacement: { kind: "replaceBodies",
   bodyIds }`.
3. Record all checkpoint `changedTargets` under the checkpoint's own ordered
   position.
4. Remove the replaced bodies and append the checkpoint outputs in one modeling
   operation.

There is no interval in committed history where both an old parametric body and
its checkpoint copy are authoritative. Unrelated body outputs remain live because
the replacement closure did not name their producer actions.

A checkpoint is an edit barrier. Editing an upstream parametric feature may
rebuild its body, but the checkpoint still replaces that upstream output with its
captured immutable post-run geometry. Downstream parametric features rebuild from
the checkpoint body. This is the intended meaning of “parametric after baked,”
not a claim that edits propagate through the baked run.

Apply-time fallback for a topology-dependent parametric consumer follows the same
rule. Its prepared post-feature checkpoint occupies the consumer's ordered
position and represents the same Onshape post-state that a successful parametric
consumer would have produced. Later `bodyOf` references therefore continue to
address that position, while later `topologyOf` references rematch against the
fallback bodies. The fallback's replacement scope is the segment delta/closure,
not every earlier action in the studio.

### 6. Emit checkpoints in source order and keep deferred references backward-only

`orderedActions` remains the authoritative import sequence. For each baked run,
the provider appends one checkpoint `createFeature` action:

- after every emitted source action at or before the run boundary that is neutral
  to body state;
- immediately after the boundary feature's represented source position; and
- before the first later action that needs the post-boundary body state.

Source features collapsed into the run do not each emit an action. The provider
maps the checkpoint ordered position to the segment boundary for probe failure
attribution and keeps a separate segment ID for review/diagnostics.

The provider maintains two maps:

- source feature ID -> emitted ordered position for sketches, constructions, and
  single-feature action dependencies; and
- Onshape body deterministic ID -> current producer descriptor (parametric action
  or checkpoint action plus captured body signature).

Deferred references use them as follows:

- `sketchIdOf` and `constructionOf` continue to point to their source actions;
- `bodyOf` points to a checkpoint only when its producer descriptor proves one
  body output;
- body-level `topologyOf` carries the source signature and is reviewed against a
  prefix that already contains the checkpoint;
- region references still point to committed parametric sketches, never into a
  baked segment;
- every deferred action index is less than its consumer's ordered position and
  still passes the existing ordered-action permutation/invariant checks.

The full-plan history probe and exact-prefix probes must use the same interleaved
checkpoint actions as prepare. Review cannot probe a parametric-only approximation
and then prepare a different segmented history.

Generated captured-frame support planes are ordinary explicit-frame plane actions
inserted before their sketch. They are auxiliary import actions, visible in the
authored history, and may be referenced with `constructionOf`.

### 7. Keep legacy fallback exact; tessellation is the current segment minimum

Segment preflight distinguishes these cases:

| Capture state | Behavior |
| --- | --- |
| `formatVersion: 1` | Existing whole-studio final-state bake and suppression semantics, unchanged. |
| `rollbackSnapshots === null` | Existing whole-studio final-state bake and suppression semantics, unchanged. |
| Required boundary snapshot absent | Abandon all segments for the studio and rerun the legacy path; do not mix partial checkpoints with a final-studio bake. |
| Boundary snapshot present with readable non-empty tessellation, STEP present | Segment checkpoint is usable. STEP is retained as source evidence/provenance but is not consumed by B.3. |
| Boundary snapshot present with readable non-empty tessellation, STEP absent | Segment checkpoint is usable with no fidelity-tier downgrade. Review may state that the checkpoint is tessellation-backed. |
| STEP present but tessellation absent/unreadable | Segment is unusable today because `bakeGeometry` accepts `baked-mesh` and STEP checkpoint ingestion is not implemented; use the legacy path. |
| Snapshot exists but replacement closure is unresolved | Use the legacy path. |
| No history probe capability | Preserve current planning/bake behavior. Segmented promotion is not claimed without exact-prefix verification. |

The all-or-legacy decision is made before the review advertises downstream
features as parametric. Prepare repeats the preflight after reviewer demotions; if
its result differs, prepare returns an actionable diagnostic rather than silently
committing a plan different from review.

The optional STEP payload is not parsed for identity. Supporting exact STEP-backed
checkpoint bodies is a future geometry-import improvement and must preserve this
segment/identity model.

### 8. Make segment diagnostics visible without erasing intrinsic feature reasons

A source feature retains its primary reason. Transform 1 remains
`transform-rotation-unsupported`; Chamfer 1 remains gated by
`topology-durable-naming-unavailable`. Segment infrastructure must not relabel
those as generic topology failures.

Reason-code changes:

| Code | New meaning |
| --- | --- |
| `downstream-of-baked` | Retained for legacy mode and for a genuine non-materializable dependency such as a baked sketch/profile or body state not represented by any usable checkpoint. It is no longer emitted merely because an earlier solid feature baked. |
| `topology-upstream-baked` | Retained for legacy/no-checkpoint attribution. A modifier whose output is available from a checkpoint no longer triggers it. |
| `bake-segment-boundary-snapshot-missing` | The exact post-boundary rollback snapshot required for a run is absent. The studio uses legacy whole-studio behavior. |
| `bake-segment-boundary-tessellation-unreadable` | The boundary exists but cannot produce a non-empty partitioned baked mesh. STEP alone does not rescue it today. |
| `bake-segment-body-unreachable` | A consumer's deterministic body ID is absent from the current parametric/checkpoint body ledger. The consumer remains in a baked run. |
| `bake-segment-body-attribution-ambiguous` | The source body exists, but matching among live checkpoint/parametric bodies is not unique. No body is chosen. |
| `bake-segment-replacement-scope-unresolved` | The planner cannot prove which producer actions the checkpoint must replace and carry forward. The studio uses legacy behavior. |
| `bake-segment-empty-output-unsupported` | A replacement-only/deletion-only run cannot be encoded by the current non-empty baked-body contract. The studio uses legacy behavior. |
| `topology-apply-rematch-failed` | Unchanged: review was unique, apply was not, and the prepared post-feature checkpoint was used. |

Provider-level diagnostics should additionally distinguish:

- `onshape-bake-segment-planned` (info, one per checkpoint);
- `onshape-bake-segment-tessellation-backed` (info when STEP is absent or unused);
- `onshape-bake-segment-legacy-fallback` (warning with the exact preflight code);
- the existing fidelity summary, extended with checkpoint count and bake strategy.

The review form adds a **Bake segments** section before per-feature fidelity. It
shows:

- strategy: none, segmented, or legacy whole-studio;
- one row per segment with feature span and boundary label;
- source body IDs produced, consumed, and carried;
- number of prior producer actions replaced;
- downstream parametric run opened by that checkpoint;
- tessellation-backed status and any preflight limitation.

Per-feature rows remain present. Baked-run members show their intrinsic reason and
segment number; downstream parametric rows show that their body dependency is
satisfied by a named checkpoint. Source-suppressed and neutral pass-through rows
are labeled as such rather than appearing to create mesh geometry.

**Rationale:** users need to see where editability stops and restarts. A single
“2 baked” count cannot explain that history structure.

### 9. Handle Mounts and Part Studio 1 as concrete acceptance cases

#### Mounts

The expected body history is:

1. Earlier sketch/extrude actions remain parametric.
2. Transform 1 remains baked with `transform-rotation-unsupported`.
3. One checkpoint is emitted from Transform 1's post-feature snapshot. It
   replaces the transformed source body's current parametric producer and emits
   the checkpoint body carrying that Onshape deterministic ID.
4. Sketch 2 does **not** claim a durable face on the body-only checkpoint. It uses
   its captured planar frame to emit an explicit-frame support plane and imports
   as a parametric sketch on that construction, with an honest
   `sketch-on-captured-frame` explanation.
5. Extrude 2 resolves its profile from Sketch 2 and its body scope from the
   Transform 1 checkpoint (`bodyOf` when the checkpoint has exactly one output,
   otherwise body `topologyOf`). It imports parametrically.
6. Chamfer 1 remains separately baked/gated until durable topology naming is
   qualified; with a usable post-Chamfer snapshot it forms a later checkpoint
   rather than causing a final-studio cascade.

Transform rotation remains out of scope. The captured-frame support plane is not
a hidden rotation implementation and does not promise associative face support;
it is the fixed world-space plane at the checkpoint barrier.

#### Part Studio 1

The 2026-07-16 audit remains the source-lineage oracle, but the interpretation
changes. Bodies shaped by baked upstream extrudes/chamfers/shells are reachable
once those baked runs emit checkpoints. Exact-prefix body matching should then
allow:

- Split 1 to resolve target `JND` and tool `JaD` from the current checkpoint/body
  ledger;
- Boolean 1 to resolve its target/tool body roles without swapping them; and
- Delete part 1 to resolve and deduplicate `J5D`/`J5H`.

Each feature promotes only after all required bodies are present uniquely in the
prefix. Parameter-specific blockers still win: unsupported split forms, boolean
offset, or other translator limits remain baked even if body identity succeeds.

Acceptance does not require edge/face consumers on checkpoint meshes to promote.

## Explicit non-goals

- Implementing transform rotation or copy.
- Giving baked meshes durable face, edge, or vertex identity.
- Using STEP subshape order, mesh component order, nearest geometry, or body-tree
  order as a topology identity rule.
- Implementing STEP checkpoint ingestion or `reconstructMeshToBrep`.
- Making edits propagate parametrically through a baked segment.
- Replacing the existing authored `bakedBody` feature or its canonical
  `replaceBodies` modeling contract.
- Solving general source-feature suppression semantics outside what segmentation
  needs to avoid false checkpoints.
- Adding a replacement-only empty baked-body feature in Phase B.
- Promoting a feature whose own parameter combination remains unsupported.

## Verification strategy

`docs/testing.md` was reviewed. Segment planning, action preparation, deferred
materialization, and rollback attribution are domain/application behavior, so the
primary lane is **logic** with `bun:test` `.spec.ts` coverage. The browser lane is
reserved for the OCC-backed import/edit behavior that cannot be established by
pure action assertions.

### Logic-lane seams

1. **Rollback body delta and replacement closure**
   - changed, introduced, removed, and unchanged body IDs;
   - one consumed output from a multi-output producer carries its live siblings;
   - prior checkpoint replacement closes transitively;
   - missing before/after state refuses selective segmentation.
2. **Pure segment planner**
   - consecutive baked body changes produce one boundary checkpoint;
   - a later reachable body consumer restarts a parametric run;
   - variables/sketches/planes are neutral/pass-through as specified;
   - suppressed features neither open nor extend a run;
   - a baked sketch plus dependent baked solid shares the solid's checkpoint;
   - reviewer demotion recomputes segments.
3. **Legacy strategy gate**
   - v1 and `rollbackSnapshots: null` plans remain byte-for-byte/action-for-action
     equivalent to today's whole-studio behavior;
   - one missing required boundary discards all partial segments;
   - missing STEP with readable tessellation stays segmented;
   - STEP-only boundary stays legacy with the exact reason.
4. **Checkpoint identity**
   - component keys preserve Onshape body IDs;
   - multi-body checkpoint queries match by signature, not ordinal;
   - equal/coincident signatures are ambiguous;
   - body bindings are injective;
   - `bodyOf` rejects zero or multiple outputs.
5. **Exact-prefix probe**
   - body-only mesh bodies contribute body signatures from render bounds;
   - they contribute no face/edge/vertex signatures;
   - a body consumer resolves from the step immediately before it.
6. **Provider preparation**
   - one checkpoint action per baked run at the expected ordered position;
   - replacement indexes name only prior `createFeature` ordered positions in the
     computed closure;
   - independent parametric bodies are neither replaced nor duplicated;
   - later `bodyOf`, `topologyOf`, `regionOf`, and `constructionOf` references are
     backward and validate.
7. **Apply pipeline**
   - checkpoint outputs are recorded and consumed by later parametric features;
   - apply-time body rematch stores only live `BodyRef`s;
   - a rematch failure swaps in the post-feature fallback at the same position and
     later actions continue;
   - final snapshots contain exactly one representation of every source body.

### Real-capture and browser acceptance

- Plan-dump Mounts before/after and assert Transform 1 remains baked while Sketch
  2 and Extrude 2 promote over its checkpoint. Confirm the captured support plane
  is explicit-frame, not a checkpoint face ref.
- Plan-dump Part Studio 1 and record whether Boolean 1, Delete part 1, and Split 1
  promote once all required source bodies are checkpoint-reachable.
- Import both captures through the browser OCC lane. Inspect authored definitions:
  no `topologyOf` or Onshape deterministic ID reaches persistence.
- Edit an upstream parametric dimension and verify checkpoint bodies remain stable
  and downstream parametric features rebuild from them.
- Edit Sketch 2 / Extrude 2 and confirm their downstream rebuild is parametric.
- Run `bun run test:all` after each implementation commit and after B.4 evidence.

## Ordered implementation tasks

Each task below is intended to be one agent commit. Tasks are ordered; later tasks
may assume earlier seams and tests are present.

### B.2 — Planner: segment-aware lineage

1. **B.2.1 Add rollback body-delta primitives.**
   - Files: `src/domain/import/onshape/rollback-topology-reader.ts` and
     `rollback-topology-reader.spec.ts`.
   - Add exact body shape keys and an exported before/after delta API returning
     introduced, changed, removed, and unchanged deterministic IDs. Preserve
     `featuresModifyingBody()` for diagnostics.
   - Verify: logic lane covers sparse snapshots, missing boundaries, body ID
     persistence, disappearance, and no-change features.
2. **B.2.2 Add the pure segment and replacement-closure planner.**
   - Files: new `src/domain/import/onshape/bake-segment-planner.ts` and
     `bake-segment-planner.spec.ts`; type exports in `fidelity-planner.ts` only as
     needed.
   - Produce `BakeSegmentPlan`, body producer ledger transitions, selective output
     sets, carried siblings, and legacy preflight results without preparing assets.
   - Verify: logic lane pins one checkpoint per run, independent body preservation,
     transitive prior-checkpoint closure, and deletion-only refusal.
3. **B.2.3 Remove global translator poisoning in favor of declared reachability.**
   - Files: `feature-translator-registry.ts`, `extrude-feature-translator.ts`,
     `wave-a-feature-translators.ts`, `wave-b-body-feature-translators.ts`,
     `sketch-feature-translator.ts`, `fallback-feature-translator.ts`, and their
     focused specs.
   - Replace direct `bakedLineageFeatureIds` writes/reads with intrinsic translation
     results plus explicit sketch/body/query inputs consumed by the segment planner.
     Do not change feature parameter support.
   - Verify: logic lane proves an independent later branch and a checkpoint-
     reachable dependent branch remain eligible, while a baked sketch/profile
     dependency still reports `downstream-of-baked`.
4. **B.2.4 Integrate `StudioBakeStrategy` into fidelity planning.**
   - Files: `fidelity-planner.ts`, `fidelity-planner.spec.ts`, and plan-dump output
     in `scripts/onshape-plan-dump.ts`.
   - Run segmentation sequentially, derive `requiresStudioBake` only for legacy
     mode, add segment reason codes, and accept reviewer demotions as replanning
     input.
   - Verify: v1/no-snapshot fixtures retain exact tier/reason behavior; synthetic v2
     histories expose segment spans/body sets; plan dump prints strategy and
     checkpoint count.

### B.3 — Provider/orchestrator: checkpoint emission

1. **B.3.1 Preserve checkpoint source-body identity in baked assets.**
   - Files: `rollback-bake.ts`, `rollback-bake.spec.ts`, and only if validation
     requires it, the baked-mesh component contract/runtime schema.
   - Encode selected segment bodies, use deterministic-ID component keys, support
     provenance spans, and prepare the planner-supplied replacement closure.
   - Verify: logic lane decodes multi-body bytes and pins component IDs/order,
     carried bodies, and exact replacement positions.
2. **B.3.2 Share live body signature derivation across review and apply.**
   - Files: new narrow helper under `src/domain/import/`,
     `kernel-history-probe.ts`, `orchestrator.ts`, and focused specs.
   - Derive native signatures when available and body-only mesh bbox/centroid
     signatures otherwise; never synthesize checkpoint subtopology. Tighten
     `bodyOf` to require exactly one output.
   - Verify: logic lane exact-prefix and materializer tests resolve one checkpoint
     body, reject multi-output `bodyOf`, and report coincident-body ambiguity.
3. **B.3.3 Emit interleaved segment checkpoints from the provider.**
   - Files: `provider.ts`, `provider.spec.ts`, and import action validation specs if
     ordered-position coverage changes.
   - Replace the “skip baked rows, append final bake” branch in segmented mode with
     one checkpoint action per planned run; maintain feature/action and body-
     producer maps; keep the current whole-studio branch untouched for legacy
     strategy.
   - Verify: prepared actions validate as a complete permutation, checkpoints occur
     at boundaries, and replacement scopes exclude independent producers.
4. **B.3.4 Wire downstream body references and same-position fallbacks.**
   - Files: `provider.ts`, `orchestrator.ts`, `actions.ts`/`validation.ts` only where
     an existing blessed body position must accept the already-defined
     `topologyOf`, plus `topology-materializer.spec.ts` and
     `apply-pipeline.spec.ts`.
   - Emit `bodyOf` only for proved single-output producers; otherwise emit body
     `topologyOf`. Build topology fallbacks with segment delta/closure and keep them
     at the consumer's ordered position.
   - Verify: Boolean/Delete/Split role order, extrude/revolve body scope, live-ref
     persistence, and downstream continuation after apply fallback.
5. **B.3.5 Add captured-frame support for sketches after body-only checkpoints.**
   - Files: `provider.ts`, the narrow sketch planning helper selected by B.2,
     provider/apply-pipeline specs, and no transform translator changes.
   - Emit a visible explicit-frame plane plus `constructionOf` sketch support when
     captured planar evidence is unique; never emit a face ref to a checkpoint.
   - Verify: a Transform-checkpoint fixture imports sketch -> extrude parametrically
     and persists a construction support, while missing/non-planar evidence remains
     baked.
6. **B.3.6 Present segments and fallback diagnostics.**
   - Files: `provider.ts` review types/form construction and `provider.spec.ts`.
   - Add the Bake segments section, strategy/checkpoint summary, source body sets,
     and review copy for every new code without replacing intrinsic feature reasons.
   - Verify: logic lane asserts segmented, no-bake, and exact legacy review forms.
7. **B.3.7 Close the synthetic integration matrix.**
   - Files: `apply-pipeline.spec.ts` and the smallest shared Onshape fixture module.
   - Cover two separated baked runs, multi-body checkpoint attribution, replacement
     closure, rematch fallback, neutral entries, and legacy v1 equivalence.
   - Verify: focused logic tests and `bun run test:all` are green; then hand off to
     B.4 for real-capture counts and browser evidence.

## Open risks

- **Signature collisions.** Two source bodies can be coincident or have equivalent
  tessellation-derived bbox/centroid evidence. The matcher must return ambiguous;
  Phase B does not add a geometry-order tie-breaker. Deterministic component keys
  improve attribution and diagnostics but do not by themselves identify a live
  Cadara body.
- **Tessellation-only fidelity.** STEP is archived but unused. Checkpoints are
  reconstructed from faceted, tolerance-bounded meshes; downstream body booleans
  may be less robust than operations over the original analytic B-rep.
- **Closed-mesh requirements.** The baked-body materializer requires each declared
  component to form a valid closed solid. A readable Onshape payload can still
  fail materialization if its facets are incomplete or inconsistent.
- **Body ID stability across source operations.** The selective delta assumes
  Onshape body IDs plus tessellation changes adequately describe introduction,
  change, and removal. An operation that rekeys unchanged bodies appears as
  remove+add; that is safe but may enlarge the checkpoint/replacement closure.
- **Action-level replacement granularity.** Carrying siblings avoids deleting
  unrepresented outputs, but may pull more bodies into a later checkpoint when an
  earlier action produced many bodies. A future per-output replacement contract
  could reduce that closure.
- **Apply/review drift.** Mesh-derived matching has less analytic evidence than
  native B-rep matching. A review-unique body can become apply-ambiguous in a
  non-empty destination; the prepared post-feature fallback remains mandatory.
- **Captured-frame sketch semantics.** A generated explicit-frame plane preserves
  placement, not associativity to the original Onshape face. The review must make
  that barrier visible.
- **Deletion-only segments.** The current baked-body contract cannot express “remove
  these bodies and produce none.” Legacy fallback remains necessary until that
  modeling capability exists.

## Summary of key decisions

- Snapshot-enabled history is segmented at body-state barriers; each baked run
  emits one checkpoint from its last feature's post-state.
- Checkpoints contain a selective rollback body delta plus any sibling bodies
  required by action-level replacement closure.
- Onshape deterministic IDs identify source components; exact-prefix signature
  matching and apply-time rematching identify live Cadara bodies. `bodyOf` is
  single-output only, while multi-body checkpoints use body `topologyOf`.
- `replaceBodyOutputs` removes only producer actions represented by the checkpoint,
  preventing duplicate old/new bodies without rebaking independent branches.
- Checkpoint meshes expose body identity only. Mounts Sketch 2 must use a captured
  explicit-frame construction plane, not a fabricated checkpoint face.
- Missing required snapshots, unreadable tessellation, unresolved replacement
  scope, no probe capability, and current deletion-only runs retain the existing
  whole-studio legacy semantics. Missing STEP alone does not block segmentation.
