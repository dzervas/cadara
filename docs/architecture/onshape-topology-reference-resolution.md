# Onshape topology reference resolution

## Status and scope

This document designs item 1.3 of `docs/onshape-importer-parity-plan.md`. It is a
foundation for the fillet/chamfer, shell, boolean/delete, mirror/transform,
split, hole, and face-backed construction-plane translators. It does not design
the parameter mapping for each of those features beyond identifying the
reference roles they need.

The resolver has one safety rule:

> A source query becomes a Cadara reference only when the source entity and one
> entity in Cadara's rebuild are both identified uniquely at the same history
> point. Otherwise the whole consuming feature bakes with a specific reason.

It must never use the nearest-looking candidate, drop one member of a selection,
or exchange target/tool roles.

## Repository findings that constrain the design

### Capture evidence available today

The envelope in `src/contracts/import/onshape-capture-bundle.ts` supports:

- `resolvedReferences` keyed by `deterministicId`, including
  `evaluatedAt: "historyPoint"` plus `consumingFeatureId`;
- optional `rollbackSnapshots`, each containing the post-feature tessellated
  faces and optional STEP text.

`src/cli/commands/onshape-capture/references.ts` sets the Onshape rollback bar to
the consuming feature's zero-based feature index, which is the state immediately
**before** that feature, and evaluates all bodies, faces, and edges there. It
currently does this only for IDs that failed at final state. The resulting
FeatureScript signatures contain class, geometry type, bounding box, and cheap
analytic data. `src/cli/commands/onshape-capture/capture.ts` separately captures
snapshots at `index + 1`, which is **after** each non-sketch feature.

These are different kinds of evidence:

- a history-point `resolvedReference` identifies a particular query result in
  the pre-consumer state;
- the nearest preceding rollback snapshot is pre-consumer geometric ground
  truth;
- the snapshot named by the consumer is post-consumer ground truth and the
  source for a per-feature bake;
- a STEP snapshot is exact geometry but carries no mapping from Onshape
  deterministic IDs to STEP subshapes.

The raw tessellated-faces payload does preserve Onshape `body.id` and `face.id`.
For example, the checked-in HackerBoard final tessellation has body `JHD`, and
Taskariki has body `JbD`. It does not preserve edge or vertex IDs, analytic
surface/curve types, or adjacency. Therefore a deterministic body/face ID can be
confirmed by exact ID equality in a rollback snapshot and can receive a
bbox/sample derived from its facets. An edge query cannot be identified from a
rollback tessellation alone.

### The checked-in bundles are not the archived v2 smoke captures

Both repository-root fixtures are currently `formatVersion: 1`, have
`rollbackSnapshots: null`, and contain final-state references only:

| Bundle | Studio | Features | References | History-point records | Rollback snapshots |
| --- | --- | ---: | ---: | ---: | ---: |
| `40a51fb8fa82fd4565151114.onshape-capture.json` | Mounts | 10 | 11 | 0 | `null` |
| `9841e486906fa2ce62d74d8e.onshape-capture.json` | Part Studio 1 | 41 | 223 | 0 | `null` |

The v2 counts in
`openspec/changes/archive/2026-07-14-add-onshape-capture-rollback-snapshots/design.md`
refer to live re-captures that were not checked in. Successful mid-history
resolution cannot be claimed against the current root files. They are useful
regression fixtures for the honest legacy fallback, but implementation
acceptance requires re-capturing both documents with v2 history resolution and
`--rollback-snapshots`.

### Actual query shapes

Feature parameters are raw Onshape records. The relevant query-list parameters
have this shape (extra fields omitted):

```ts
{
  btType: "BTMParameterQueryList-148",
  parameterId: "entities",
  queries: [{
    btType: "BTMIndividualQuery-138",
    queryStatement: null,
    queryString: "query=qCompressed(...);",
    nodeId: "...",
    deterministicIds: ["KMhB"]
  }]
}
```

No query object in either checked-in bundle has a `geometryIds` property. The
usable query key is `deterministicIds`; the geometry IDs are the `id` fields on
captured tessellation bodies/faces. `queryString` is useful for diagnostics and
limited producer hints, but most strings are opaque `qCompressed(...)` values
and must not be the primary resolver.

Concrete entries include:

| Feature | Parameter and IDs | Intended role / current evidence |
| --- | --- | --- |
| Mounts `Transform 1` (`FKFj5KgXfGGLv7N_1`) | `entities: [JHD]`, `transformAxis: [KHJB]` | `JHD` resolves at final state as `body:unknown`; `KHJB` is unresolved. The feature is `transformType: ROTATION`, which Cadara's current transform implementation does not support. |
| Mounts `Chamfer 1` (`FqXExmahcCNDI8A_1`) | `entities: [KMhB]` | Edge selection, unresolved at final state. |
| Taskariki `Incline` (`FJdcdgxDbuPo86k_0`) | `entities: [JFB, JCC]` | `JFB` is an edge/line and `JCC` is the Front datum face/plane; `cplaneType: LINE_ANGLE`. The current Cadara plane contract has coplanar or explicit-frame modes, not line-angle. |
| Taskariki `Chamfer 1` / `Chamfer 2` | `entities: [JNB]` and `[JNR, JPZ, JPd, JPF, JPJ]` | Edge lists, all unresolved at final state. |
| Taskariki `Shell 1` (`Fi8k4Db3MmHpaIG_1`) | `parts: [JND]`, `entities: []`, `isHollow: true` | Body selection with no removable faces. OCC's current shell executor requires at least one face target, so this parameter combination must bake independently of reference resolution. |
| Taskariki `Split 1` (`FQtApb0Sk3fJDW8_2`) | `targets: [JND]`, `tool: [JaD]` | Target body and tool body; both unresolved at final state. This maps to Cadara `split` only for the supported body-tool form. |
| Taskariki `Boolean 1` (`FThhOjyWzjnevIO_1`) | `tools: [JbD]`, `targets: [JbH]` | Tool and target bodies. `JbD` resolves as a body; `JbH` does not. `entitiesToOffset: [J1q, J1S]` is inactive because `offset` is false and must not block translation. |
| Taskariki `Delete part 1` (`FBJ2f99buwMPxgO_1`) | `entities` and `nonCompositeEntities` both contain `[J5D, J5H]` | Duplicate encodings of the same body selection; deduplicate by `(role, deterministicId)` without changing order. |

The bundles contain chamfer, shell, split, boolean, delete, transform, and
cPlane examples. They contain no `fillet`, `mirror`, or `hole` feature entries,
so those query shapes need focused synthetic fixtures until another real
capture is added.

### Existing matcher and kernel limits

`src/domain/import/onshape/signature-matcher.ts` currently:

- requires exact entity-class and case-insensitive geometry-type equality;
- scores only centroid and bounding-box distance;
- ignores `definingData`, `tessellationSample`, and `owningFeatureId`;
- uses fixed `1e-4` document-unit centroid/bbox tolerances;
- returns `unique`, `ambiguous`, or `noMatch` and never deliberately guesses.

Its non-guessing result union should remain, but its evidence model is too weak
for production topology selection. In particular:

- Onshape cylinder/circle data uses `axis`; kernel signatures use
  `axisDirection`.
- `scaleCapturedSignatureToDocumentUnits` in `provider.ts` scales bbox and
  centroid only, not dimensional fields such as origins, centers, radii, or
  tessellation samples.
- `src/domain/modeling/occ/topology-signatures.ts` emits face, edge, and vertex
  signatures, but no body signature, although the probe contract permits one.
- Kernel face centroids are bbox centers over mesh vertices, not mass
  centroids. Onshape capture currently also derives its `centroid` from its bbox.
- Kernel circle bbox generation describes the full circle, while Onshape's
  `evBox3d` may describe a trimmed arc. Circle bbox cannot be a hard equality
  gate when center/radius/axis agree.
- capture currently does not populate `tessellationSample` or
  `owningFeatureId`.

`src/domain/import/kernel-history-probe.ts` already returns all live topology
signatures after every prepared action. However,
`activateProbeBackedPlanning()` in `provider.ts` uses the last rebuilt step,
not the step immediately before each consumer. That is sufficient only for its
narrow final-prefix face-sketch experiment.

Finally, Cadara has the reference machinery needed for durable results:
`DurableRef` in `src/contracts/shared/references.ts`, authored feature contracts
in `src/contracts/modeling/schema.ts` and `advanced-solid.ts`, and topology
reconciliation/invalidation in `src/domain/modeling/occ/topology.ts` and
`topology-naming.ts`. Replacement operations preserve an old topology ID only
for a unique successor and otherwise emit explicit deleted/missing/ambiguous
invalidation. That is the required later-edit behavior.

There is one release gate: `OCC_KERNEL_CAPABILITIES` in
`src/domain/modeling/opencascade-kernel-seed.ts` currently advertises
`supportsDurableTopologyNaming: false`. The importer must not claim durable
references while that capability is false. The existing naming implementation
must be qualified by rebuild/edit tests and the capability enabled, or every
subtopology consumer must degrade with
`topology-durable-naming-unavailable`. Body-only consumers may proceed because
body identity is independently durable.

## Durable naming qualification status

**Status (2026-07-18): qualified.**
`OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming` is `true`.

The pre-8 implementation retains matching per-feature/output stages and projects
stable authored sketch source keys through OCC producer history. Rebuild
reconciliation compares semantic source-key lineage only; it does not use nearest
geometry or topology traversal order. For every prior public subtopology ID, exact
source lineage now yields one of three outcomes before downstream execution:

- zero successors: `occ-topology-deleted`;
- one uniquely claimed successor: preserve the prior public ID;
- multiple successors or competing prior claims: `occ-topology-ambiguous`.

A producer or source role without complete semantic/operation history invalidates
prior topology as `occ-topology-unsupported-history`. Fresh topology IDs are also
quarantined when they coincide with an invalidated prior ID but have no stage proof,
so an exact delete-and-recreate cannot resurrect a stale reference.

Real-OCC logic qualification in
`src/domain/modeling/occ/topological-naming.spec.ts` proves:

- dimension-only edits preserve moving edge references for downstream fillet and
  chamfer and a moving face reference for shell;
- a rectangle-to-triangle sketch edit reports the removed generated edge as deleted
  instead of remapping it;
- exact semantic source keys produce pinned zero, one, and many outcomes;
- coincident delete/recreate remains invalid without semantic stage proof;
- rebuilt unsupported producers such as thicken invalidate prior subtopology as
  unsupported history;
- operation-local deleted and split successors remain deleted/ambiguous with
  structured `invalidReference` diagnostics; and
- independent feature reorder, suppression, and re-enable preserve valid downstream
  references without cross-associating feature stages.

The former `test.fails` capability gate is now a passing assertion, and the focused
OCC suite passes with no expected failures. Phase S.1 importer plan-time promotion
is therefore unblocked. The semantic source-key contract remains compatible with
the planned BRepGraph migration; its temporary JS-held stage bodies and pre-8
reconciliation machinery should be removed at that cutover.

## Design decisions

### 1. Resolve explicit, translator-declared query roles

The resolver will not recursively treat every query in a feature as active.
Each translator declares the slots relevant to its supported parameter
combination:

```ts
export interface TopologyQuerySlot {
  key: string; // e.g. "edgeTargets", "toolBodies"
  parameterId: string;
  role: "body" | "targetBody" | "toolBody" | "face" | "edge" | "plane" | "axis";
  expectedKinds: readonly ("body" | "face" | "edge" | "vertex" | "construction")[];
  cardinality: { min: number; max: number | null };
}

export interface OnshapeTopologyQueryRef {
  consumerFeatureId: string;
  slotKey: string;
  parameterId: string;
  queryIndex: number;
  deterministicId: string;
  queryString: string | null;
  expectedKinds: TopologyQuerySlot["expectedKinds"];
}
```

`readTopologyQueryRefs(feature, slots)` defensively reads
`parameters[].queries[].deterministicIds[]`, preserves source order, and reports
malformed/missing/cardinality errors. The translator decides whether a slot is
active first. Thus Boolean 1 does not resolve `entitiesToOffset` when `offset`
is false, and duplicate delete-body encodings do not create duplicate Cadara
participants.

Expected consumer mappings are:

- fillet: edge refs -> `FilletFeatureParameters.edgeTargets`;
- chamfer: edge refs -> advanced participant `role: "edge"`;
- shell: one body plus removable faces -> `bodyTarget` and `faceTargets`;
- boolean: target/tool body roles -> `combine` participants;
- delete: body refs -> `deleteSolid` participant `body`;
- mirror: body refs plus a face/construction plane;
- transform: body refs plus the reference required by the supported transform
  mode;
- split: target body plus supported body tool (face/plane tools stay capability
  gated by the OCC implementation);
- face-backed cPlane: face ref -> `PlaneFeatureParameters` coplanar reference;
- hole: only roles accepted by the eventual hole translator and kernel. The
  contract lists `hole`, but OCC currently has no `executeHoleFeature`; reference
  success alone must not promote it.

### 2. Establish the Onshape entity at the pre-consumer state

For every query ref, evidence is selected in this order:

1. a resolved `historyPoint` record whose `consumingFeatureId` exactly equals
   the consumer;
2. exact deterministic-ID equality to a body/face `id` in the nearest rollback
   snapshot at or before the consumer's pre-state, deriving bbox/centroid and a
   bounded tessellation sample from that entity;
3. a final-state signature only when it is proven equivalent to pre-consumer
   evidence (same body/face ID and compatible rollback-derived geometry), or for
   immutable canonical datums.

A final-state signature by itself is not safe for a mid-history consumer. A
later transform can move a still-resolvable body, so matching that final bbox to
the pre-transform Cadara rebuild would select incorrectly or miss. For edges,
a rollback snapshot cannot provide the missing identity; a history-point
signature is mandatory.

This reveals a capture-side requirement that fits the existing v2 schema. When
`--rollback-snapshots` is requested for a topology-capable import capture,
`resolveDeterministicIdsWithHistory()` must evaluate all deterministic IDs at
each consuming feature's point, not merely IDs that failed final-state
resolution. This conservative rule avoids duplicating translator slot semantics
inside the CLI. The current cheaper failure-only behavior may remain when
snapshots are not requested. No bundle schema change is needed; additional
history-point records are additive.

If no safe pre-consumer evidence exists, return
`topology-history-evidence-missing`. If Onshape itself reports unresolved at the
history point, return `topology-source-query-unresolved`. If the captured class
is not allowed by the slot, return `topology-source-kind-mismatch`.

### 3. Match against Cadara at the same history point

The planner builds the parametric prepared-action prefix for all earlier
features and probes that prefix in an isolated kernel session. The candidate
set for a consumer is the signatures from the last action **before** that
consumer, never a later or final step. The provider already maintains Onshape
feature ID to ordered-action position in `buildPreparedActions`; that
correlation becomes an explicit planning artifact rather than an optional
failure sink.

Topology-dependent planning is sequential:

1. plan and emit every probe-free feature before the consumer;
2. evaluate that prefix;
3. resolve the consumer's required slots against the prefix result;
4. if unique, append a provisional version of the consumer and continue;
5. if not, append its post-feature baked checkpoint when available and mark
   downstream subtopology as unavailable.

The current probe API creates a fresh session per call, so a simple first
implementation may re-probe the growing prefix. If review latency is excessive,
a later API can retain one isolated session; correctness must not be traded for
using the wrong step.

#### Signature normalization and matching

Captured meters are normalized to document millimeters before matching,
including dimensional `definingData` fields and samples. Alias normalization
maps Onshape `axis` to kernel `axisDirection`. Directions remain unitless.

Candidates pass hard gates before scoring:

- exact entity class and compatible geometry family;
- expected durable-ref kind;
- analytic invariants where both sides provide them: unoriented plane/axis
  angle, plane offset, line support/direction, center/origin, and radius;
- bbox extent/center within a linear tolerance when bbox semantics are
  comparable.

The tolerance policy is explicit input, not a hidden global constant:

```ts
export interface TopologyMatchTolerance {
  linear: number;
  angularRadians: number;
  relative: number;
  ambiguityMargin: number;
}
```

`linear` is at least the document modeling tolerance. Rollback-derived geometry
also accounts for its captured chord tolerance; that wider tolerance may admit
more candidates, in which case the result is ambiguous rather than choosing the
lowest score. Trimmed-circle bbox is a soft score when analytic circle data is
available. Missing analytic data never earns a false exact match: bbox-only
matching is allowed only when it leaves one candidate well separated under the
ambiguity policy.

The matcher retains three outcomes and adds evidence details:

```ts
type TopologyMatchOutcome =
  | { kind: "unique"; reference: DurableRef; score: number; evidence: string[] }
  | { kind: "ambiguous"; candidates: readonly MatchCandidate[] }
  | { kind: "noMatch"; rejected: readonly MatchRejection[] };
```

Multiple individually ambiguous IDs are not solved by arbitrary permutation.
A future set matcher may accept a permutation only when every valid assignment
produces the same unordered selected set; that optimization is not required for
v1 of the resolver.

Kernel signature extraction must add a body signature (body bbox center/extent
and `BodyRef`) and define body geometry-family compatibility so captured
`body:unknown` can match a probed solid only with strong bbox evidence. This is
required for booleans, delete, split, transform, and mirror.

### 4. Emit live durable refs, not sandbox IDs

The unique `DurableRef` returned by review's isolated probe is evidence, not a
value safe to persist. The probe runs in a separate document, and feature/body
IDs allocated there can differ when the destination document is not empty.
Directly embedding that ref would couple correctness to allocator coincidence.

The plan therefore carries a deferred topology selector:

```ts
export interface ImportDeferredTopologyRef {
  kind: "topologyOf";
  expectedKind: "body" | "face" | "edge" | "vertex";
  capturedSignature: OnshapeGeometricSignature; // normalized document units
  tolerance: TopologyMatchTolerance;
  source: {
    consumerFeatureId: string;
    parameterId: string;
    deterministicId: string;
  };
}
```

At apply time, immediately before creating the consumer, the import
materializer derives signatures from the real current document bodies and runs
the same matcher again. A unique result is replaced with that live
`BodyRef`/`FaceRef`/`EdgeRef`/`VertexRef`. Only then is a normal Cadara
`CreateFeatureRequest` sent to the modeling service. No `topologyOf` value is
allowed into authored modeling contracts or persistence.

The blessed deferred positions must be typed explicitly for fillet targets,
shell body/faces, advanced participants, plane references, and face-backed
sketch support; the implementation must not recursively substitute arbitrary
objects.

Once committed, the feature definition contains ordinary `DurableRef`s exactly
as interactive Cadara features do. On rebuild, OCC topology naming and operation
history preserve a reference only for a unique successor. Deleted or ambiguous
successors produce the existing machine-readable invalid-reference diagnostics
rather than remapping silently.

### 5. Treat review and apply failures as per-feature bakes

A topology consumer is all-or-nothing. If any required query is unreadable,
unresolved, unmatched, or ambiguous, the complete feature is baked. It is not
acceptable to chamfer four of five selected edges or to run a boolean with one
missing tool.

Proposed planner reason codes are:

| Reason code | Meaning |
| --- | --- |
| `topology-query-unreadable` | Required parameter/query/deterministic-ID structure is malformed. |
| `topology-history-evidence-missing` | No safe pre-consumer source signature is available. |
| `topology-source-query-unresolved` | Onshape could not resolve the ID at the consuming history point. |
| `topology-source-kind-mismatch` | Captured entity class is invalid for the translator slot. |
| `topology-reference-no-match` | No Cadara entity passes the gates/tolerance at that prefix. |
| `topology-reference-ambiguous` | More than one Cadara entity remains plausible. |
| `topology-durable-naming-unavailable` | A subtopology ref is required but the kernel does not advertise durable naming. |
| `topology-upstream-baked` | A queried entity was produced or reshaped by a non-parametric (baked) upstream feature, so it cannot exist in the parametric prefix. Attribution uses the rollback-snapshot timeline (`featuresModifyingBody`). |
| `topology-apply-rematch-failed` | Review was unique, but the real apply-state rematch was not. |
| `topology-bake-snapshot-missing` | The feature failed and no post-feature rollback snapshot exists for an honest checkpoint. |

Unsupported feature parameters retain translator-specific codes instead. For
example, the checked-in rotation transform, line-angle cPlane, hollow shell with
no openings, two-offset chamfer, offset boolean, face-tool split, or unimplemented
hole should not be mislabeled as topology matching failures.

For a v2 bundle with rollback snapshots, the fallback is the snapshot named by
the failed consumer (the post-feature state), encoded as a baked checkpoint that
replaces prior body outputs. The feature's diagnostic records the primary reason
above and identifies the failed parameter and deterministic ID. A later
subtopology consumer of that body cannot resolve against the current body-only
baked-mesh implementation and gets its own honest checkpoint/reason.

Apply-time rematching uses a prepared fallback definition and substitutes the
consumer's baked checkpoint if matching changed between review and apply. If no
post-feature snapshot exists, apply fails atomically rather than authoring a
wrong ref.

For the current v1 root bundles, per-feature geometry is unavailable. The only
honest geometry fallback is the existing final studio bake, with
`topology-history-evidence-missing` plus `topology-bake-snapshot-missing`; later
features remain suppressed. This limitation must be visible in review.

## Verification strategy

`docs/testing.md` was reviewed. Resolver, matcher, provider planning, and import
orchestration are non-UI domain/application behavior, so their primary lane is
**logic** using `bun:test` `.spec.ts` files. Browser interaction is reserved for
the durability behavior that cannot be proved by pure planning assertions.

### Logic-lane specs

1. `src/domain/import/onshape/topology-query-reader.spec.ts`
   - use exact parameter snippets from both bundles;
   - preserve query/deterministic-ID order;
   - ignore inactive Boolean 1 offset queries;
   - deduplicate Delete part 1's duplicate body encoding;
   - reject malformed slots and cardinality mismatches.
2. `topology-reference-evidence.spec.ts`
   - prefer the exact consumer's history-point record;
   - choose the preceding, not post-consumer, rollback state;
   - derive body/face evidence by exact tessellation ID;
   - prove that tessellation cannot fabricate edge evidence;
   - reject unsafe final-only mutable topology.
3. Extend `signature-matcher.spec.ts`
   - unit conversion for bbox, origins/centers/radii, and samples;
   - plane, cylinder, line, circle, vertex, and body matching;
   - axis alias/orientation handling and trimmed-circle bbox behavior;
   - explicit equal/symmetric ambiguity and out-of-tolerance misses.
4. Extend `topology-signatures.spec.ts` and
   `kernel-history-probe.spec.ts`
   - body signatures carry `BodyRef`;
   - the selected candidate set comes from the pre-consumer step;
   - probe IDs are not assumed to be destination IDs.
5. `topology-reference-resolver.spec.ts`
   - exported resolver seam returns typed deferred refs only on unique matches;
   - every failure outcome maps to its exact reason;
   - one failed member degrades the whole feature.
6. `orchestrator`/deferred-materializer specs
   - `topologyOf` becomes a concrete live `DurableRef` in every blessed feature
     position;
   - an apply-state ambiguity selects the prepared bake fallback;
   - no deferred value reaches persistence.

### Apply-pipeline coverage

Extend `src/domain/import/onshape/apply-pipeline.spec.ts` at the provider ->
prepare -> `applyImportPreparedActions` seam:

- a compact v2 fixture should commit an extrude followed by a matched fillet or
  chamfer and assert the stored feature definition contains the live edge ID,
  not the probe ID or `topologyOf`;
- body-role cases should cover combine, deleteSolid, and split without swapping
  target/tool participants;
- ambiguity should commit exactly one baked checkpoint and continue without an
  error diagnostic;
- apply rematch failure should take the same per-feature fallback.

The two root bundles must also be exercised. Before re-capture, tests should
assert their explicit legacy degradation and final-studio bake. They cannot be
used to assert successful topology resolution in their current form. The
acceptance fixture update is to re-capture both as v2 with snapshots and then
assert, feature by feature, either a concrete durable ref or the exact supported-
parameter/bake reason. A static MockKernel topology unrelated to the real bundle
is not sufficient evidence; the successful real-bundle path must use a replay
harness backed by the actual OCC rebuild or run in the browser OCC lane.

Run `bun run test:all` after implementation.

### Interactive durability checks

In the OCC-backed app, import each snapshot-enabled bundle and inspect the
committed definitions. Then:

1. edit an upstream sketch dimension or variable that changes size but not
   topology;
2. rebuild and verify the downstream chamfer/fillet remains on the same semantic
   edge, remains unsuppressed, and has no invalid-reference diagnostic;
3. edit the fillet/chamfer radius and rebuild;
4. suppress/re-enable or legally reorder an intermediate feature;
5. make an edit that genuinely deletes or splits the selected edge and verify an
   explicit invalid/ambiguous reference diagnostic appears instead of the
   feature moving to another edge.

The load-bearing check is: **edit an upstream dimension, and the fillet/chamfer
stays on the intended edge**. Visual survival alone is not enough; the authored
feature must still contain the same durable ref or a uniquely reconciled
successor, and no fallback bake may have replaced it.

## Implementation task breakdown

Tasks are ordered so a coding agent can land and verify each seam independently.

1. **Establish acceptance captures.** In
   `src/cli/commands/onshape-capture/references.ts`, make snapshot-enabled capture
   evaluate all deterministic IDs at each consuming history point, even when an
   ID resolves finally. Re-capture both root documents as v2 with
   `--rollback-snapshots`; keep the existing envelope. Verify edge consumers have
   history-point signatures and record any still-unresolved classes.
2. **Read rollback topology evidence.** Add
   `src/domain/import/onshape/rollback-topology-reader.ts` with narrow,
   surplus-tolerant readers for tessellation body/face IDs and facets. Expose
   `snapshotBeforeFeature(featureId)` and `snapshotAfterFeature(featureId)` using
   feature-list order. Add exact fixture snippets and diagnostics; do not parse
   STEP subshape order as identity.
3. **Read declared query slots.** Add
   `src/domain/import/onshape/topology-query-reader.ts` with the
   `TopologyQuerySlot` / `OnshapeTopologyQueryRef` interfaces above. Keep active
   slot declaration in each feature translator, not in a global recursive
   heuristic.
4. **Normalize and strengthen signatures.** Add
   `topology-signature-normalizer.ts`; extend `signature-matcher.ts` with explicit
   tolerance input, analytic gates, alias handling, and rejection evidence.
   Preserve its `unique | ambiguous | noMatch` policy. Add body extraction to
   `src/domain/modeling/occ/topology-signatures.ts`.
5. **Implement the pure resolver.** Add
   `src/domain/import/onshape/topology-reference-resolver.ts` exporting roughly:

   ```ts
   resolveTopologyReferences(input: {
     consumerFeatureId: string;
     queries: readonly OnshapeTopologyQueryRef[];
     capturedReferences: readonly OnshapeResolvedReference[];
     rollback: RollbackTopologyTimeline;
     cadaraSignatures: readonly HistoryProbeTopologySignature[];
     tolerance: TopologyMatchTolerance;
     durableNamingAvailable: boolean;
   }): TopologyResolutionResult;
   ```

   Return bindings with review evidence and deferred selectors, or one typed
   degradation with per-query details.
6. **Probe exact prefixes.** Add
   `topology-resolution-planner.ts` to correlate Onshape features with prepared
   action positions and probe the growing prefix immediately before each
   consumer. Replace the final-step assumption in `provider.ts`; retain final
   tessellation only for whole-plan verification.
7. **Materialize live refs.** Extend
   `src/contracts/import/actions.ts` with typed `ImportDeferredTopologyRef`
   positions and `ImportDeferredMaterializer` in `orchestrator.ts` with
   apply-time signature derivation/rematching. The actual modeling request must
   contain only canonical `DurableRef`s. Pair topology-dependent requests with a
   pre-registered post-feature baked fallback.
8. **Add per-feature checkpoint fallback.** Extract the existing tessellation
   encoder from `provider.ts` into
   `src/domain/import/onshape/rollback-bake.ts`. Emit a baked replacement at the
   failed feature's history position; retain final-studio bake only for v1/no-
   snapshot cases. Add the reason codes above to the fidelity plan and review
   diagnostics.
9. **Qualify durable naming.** Add OCC rebuild specs that preserve edge/face IDs
   through dimension-only upstream edits and invalidate deleted/ambiguous
   successors. Enable `supportsDurableTopologyNaming` only when those tests pass;
   otherwise keep subtopology import gated.
10. **Consumer adoption.** Phase-B translators request slots from the shared
    resolver and map successful bindings directly into the contracts listed
    above. Each translator separately gates unsupported parameter combinations;
    reference resolution must not imply feature support.
11. **Integration verification.** Add the logic/apply-pipeline coverage above,
    run both v2 real bundles through an OCC-backed replay, perform the interactive
    durability checks, and run `bun run test:all`.

## Summary of key decisions

- History-point reference records identify source topology; rollback snapshots
  corroborate body/face IDs, verify post-feature geometry, and provide
  per-feature bakes. Tessellation alone cannot resolve edges.
- Final-state signatures are not accepted for mutable mid-history topology
  without pre-consumer corroboration.
- Matching occurs against the Cadara action step immediately before each
  consumer, with normalized analytic signatures and explicit ambiguity policy.
- Sandbox probe refs are never persisted. Apply rematches the selector against
  the real document and emits a normal Cadara `DurableRef`.
- Any required-reference failure bakes the whole feature with a specific reason;
  no partial selection or nearest-candidate guess is allowed.
- The current checked-in bundles prove only legacy fallback. Snapshot-enabled v2
  re-captures and qualification of Cadara's currently-disabled durable naming
  capability are acceptance gates for claiming parametric topology consumers.
