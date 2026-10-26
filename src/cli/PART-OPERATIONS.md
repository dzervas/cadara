# cadara CLI: document and part operations

Per-operation fields, units and selector rules for features and bodies. Shared rules (envelopes, errors, targets, recipe versions) are in [README.md](README.md).

## Feature lifecycle and rollback timeline

The following operations require a current `basis` and explicit `intent`
(`fulfill` or `author-invalid`) in document context, outside a private sketch:

- `feature.suppression.set`: `featureId`, `suppressed` boolean; restoration
  uses `false` and preserves the feature identity.
- `feature.delete`: `featureId`; removes the authored feature.
- `feature.reorder`: `featureId`, `beforeFeatureId` (null appends).
- `body.rename`: `bodyId`, `label`; preserves body identity and geometry.
- `body.color.set`: `bodyId`, `appearance` is `{ kind: "palette", slot }`
  (`0`-`5`: Natural, Berry, Jade, Violet, Coral, Aqua) or
  `{ kind: "custom", hex }` (lowercase `#rrggbb`); an undoable display-colour
  change that preserves body identity and geometry.
- `target.delete`: a typed durable `target`; uses production supported-target
  deletion semantics (deleting a body authors a `deleteSolid` feature).
- `timeline.cursor.set`: `cursor` is `{ kind: "empty" }`,
  `{ kind: "sketch", sketchId }` or `{ kind: "feature", featureId }`.
- `timeline.reorder`: typed sketch/feature `item` and `beforeItem` (null appends).

Discovery `model.features` includes actual suppression state and produced
identities; `model.cursor` and `model.timeline` describe the current authored
rollback position/order; `model.bodies[].appearance` is each body's persisted
colour (new bodies get an automatic palette slot). Cursor movement changes
evaluated geometry without removing later feature records. It is **not**
author-scoped `history.undo` or `history.redo`, nor replay of private history.
Native files retain authored suppression, body labels, body colours and cursor,
not the process's undo stack.

Recipes accept exact unique `{ alias, label }` references for `featureId`,
`beforeFeatureId`, `bodyId`, `target`, `cursor`, `item` and `beforeItem`, using
references from that alias's discovery. Null anchors remain null. Missing or
ambiguous labels fail before the operation; unknown aliases are usage errors.
Dependency-invalid orders, unsupported/deleted targets and stale bases refuse.
Accepted edits still require an exact persistence receipt, rebuilt geometry and
current handoff. Invalid downstream geometry is not fulfillment; only explicit
`author-invalid` can accept it as editable invalid state. A write failure does
not imply rollback of an already applied live edit.

## Extrusion variants and rebuild

`extrude.create` takes a current `basis`, a typed region `profile`
(`{ kind: "region", sketchId, regionId }`), positive `depth` in document units,
and `intent`. `extrude.update` takes the current `basis`, `featureId`, `depth`
and `intent`. They reuse production feature preparation, mutation and rebuild.
Instead of the `profile`/`depth` shorthand, both commands accept `parameters`
using the existing `ExtrudeFeatureParameters` contract (not a raw document patch).
`extrude.update` still requires `featureId`. The two input forms are exclusive.
For example, a symmetric standalone solid uses:

```json
{
  "resultBodyType": "solid",
  "profiles": [{ "alias": "published", "label": "Outer region" }],
  "startExtent": { "kind": "profilePlane" },
  "extent": {
    "mode": "symmetric",
    "end": {
      "kind": "blind", "direction": "positive",
      "distance": { "source": "literal", "value": 4 }
    }
  },
  "operation": { "source": "literal", "value": "newBody" },
  "booleanScope": { "kind": "standalone" }
}
```

Canonical scalar values use `{ source: "literal", value }` or
`{ source: "expression", valueText }`; distances use document units and draft
angles use radians. A symmetric blind distance is the depth **on each side**.
`twoSide` has independent `firstEnd` and `secondEnd`; `oneSide`/`symmetric` have
`end`. Supported end conditions follow production: `blind`, `throughAll`,
`upToNext`, `upToFace`, `upToPart`, and `upToVertex`; symmetric ends are limited
to blind/through-all. Reference ends require exact typed `target` references;
up-to offsets have authored `distance` and `direction: "shorten" | "extend"`.
Starts use `profilePlane`, `blindOffset` (authored distance and direction),
`sketchPointOffset` (exact sketch point target), or `entityOffset` (exact planar
edge/face target). Existing starts survive shorthand depth edits.

`resultBodyType: "surface"` creates a sheet and has no `operation` or
`booleanScope`. Profiles can be a region, planar face, or a connected chain of
open `sketchEntity` curves from one sketch. Surface extrusion does not close an
open boundary to manufacture a solid. Surface drafts, open-curve up-to-next,
mixed/disconnected profile groups and unsupported termination cases are refused
by shared preparation/production evaluation, never silently approximated.
Solid booleans use authored `operation: newBody | join | cut | intersect` and
explicit `booleanScope: standalone | targetBody | targetBodies`; no implicit
scene-wide scope is inferred. Reference and scope failures can leave an applied,
persisted but invalid feature: `fulfill` reports geometry failure;
`author-invalid` explicitly permits `accepted-invalid`/`invalid-editable` only
when the production owner actually accepts that state. A production rejection
remains a rejection for either intent.

Recipe `parameters.profiles` also accepts exact unique label aliases, as does a
singular `booleanScope: { kind: "targetBody", bodyId }` (an exact body label);
nested start/end targets and plural `targetBodies` currently require typed
discovered references. Up-to-next must prove complete termination of the swept profile,
not choose an arbitrary first contact or partially covering target.

Discovery includes feature/produced-body identities and `model.bodies[].bounds`
(`min`/`max`) from native B-rep inspection; null means no certified measurement,
never last-good display geometry. A rejected request applies nothing; an applied
revision with failed geometry or persistence is still command failure.

Recipes can resolve `profile` and `featureId` with exact unique label selectors,
for example `{ "alias": "published", "label": "Outer region" }` and
`{ "alias": "solid", "label": "Extrude 1" }`. Stale bases and ambiguous labels
are refused. `sketch.open` takes a current `basis` and `sketchId` (or its CLI label
selector) to reopen a committed private draft. Updating a driving requirement
and publishing settles the production cursor restoration and downstream rebuild
before returning current solid output. Re-discover references after edits.

## Revolve solids and sheets

`revolve.create` takes current `basis`, explicit `intent` and canonical
`RevolveFeatureParameters` in `parameters`. `revolve.update` additionally takes
`featureId`. Both use the browser feature builder and the same production
mutation, exact persistence receipt, native output and handoff checks as extrusion.
For example, a standalone full solid uses:

```json
{
  "resultBodyType": "solid",
  "profiles": [{ "alias": "published", "label": "Outer region" }],
  "axis": { "alias": "published", "label": "Line 1" },
  "startAngle": { "source": "literal", "value": 0 },
  "extent": { "mode": "oneSide", "end": { "kind": "full" } },
  "operation": { "source": "literal", "value": "newBody" },
  "booleanScope": { "kind": "standalone" }
}
```

Axes are exact linear `edge` or solved line `sketchEntity` references.
Construction-backed **axis references** are not supported by the production
kernel; an ordinary sketch line marked construction is still a sketch-entity
axis. A solid requires one closed region or planar face. A surface has no
boolean fields and accepts one region/face wire or one connected open-curve
chain from one sketch. Mixed/disconnected and unsupported multi-profile groups
are refused; open curves are not closed to invent solid support.

`startAngle`, blind `angle` and reference-offset `angle` are authored scalar
wrappers, in radians (expressions use the shared expression evaluator).
`oneSide.end` accepts `full`, `blind`, `upToNext`, `upToFace`, `upToPart` and
`upToVertex`. Non-full ends specify `direction: "clockwise" |
"counterClockwise"`. `symmetric.end` is blind, with the given angle on **each**
side; `twoSide` has non-full `firstEnd` and `secondEnd`. Solid symmetric/two-sided
results retain the production separate-body-per-side behavior; no extra fusion
is performed. Two-sided sheets require
opposite directions and may not overlap beyond a full revolution. Reference
ends use exact typed body/face/vertex targets and optional authored angular
`offset` with `direction: "shorten" | "extend"`. They retain production angular
target resolution and ambiguity/impossible-termination refusals, not a new
collision or contact algorithm. Solid booleans retain explicit operation/scope.

Recipes resolve exact unique label aliases in `parameters.profiles`,
`parameters.axis` and `featureId`. Nested end targets and boolean body IDs remain
typed discovered references. Re-discover after edits. Rejection leaves live state
unchanged; accepted authored state with missing native output is **not**
fulfillment. Only explicit `author-invalid` permits accepted editable invalid
state, and does not override production rejections. Native body kind/bounds and
current feature/topology references are returned in discovery.

## Construction planes

`plane.create` and `plane.update` take current `basis`, explicit `intent`, and
canonical `parameters`; update also takes a discovered `featureId` (or its exact
unique feature-label alias). Supported forms are `mode: "coplanar"` with
`reference: { target: <construction or planar face> }`, and `mode: "explicitFrame"`
with a complete world-space `frame`, for example:

```json
{
  "mode": "explicitFrame",
  "frame": {
    "origin": [3, 4, 5],
    "xAxis": [0, 1, 0],
    "yAxis": [0, 0, 1],
    "normal": [1, 0, 0],
    "linearUnit": "documentLength",
    "handedness": "rightHanded"
  }
}
```

Browser hydration/build and semantic preparation preserve the same explicit
frame and share right-handed orthonormal validation. Degenerate or left-handed
axes refuse rather than being normalized. No general offset/angle authoring is
added. Coplanar target resolution remains production-owned; missing/nonplanar
references cannot fulfill, including after an update of a previously valid plane.
An accepted invalid revision is reported as applied with failed geometry for
`fulfill`, not as rollback or successful creation.

Discovery `model.constructions` exposes current construction IDs, owning feature
IDs and actual frames. `references` supplies the construction target and its
exact unique label for recipes (`parameters.reference.target` accepts a target
alias). IDs remain stable when updating the owning feature. Use these discovered
targets as sketch supports or subsequent coplanar seeds; do not infer identity
from the displayed outline. Completion requires current native construction
output, the exact repository transaction and authoritative handoff, not a body
bounding box. No solid is created by a plane alone.

## Solid edge treatments

`fillet.create` / `fillet.update` and `chamfer.create` / `chamfer.update`
take current `basis`, explicit `intent`, and canonical `parameters`. Updates
also require the discovered `featureId`. These use the same browser feature
preparation, production mutation and native topology/history owners.

Fillet parameters are `{ edgeTargets: [<edge ref>], radius: { source:
"literal", value: 1 } }`. Radius uses the canonical authored scalar (expressions
use `{ source: "expression", valueText }`), must resolve positively and fit the
solid. Chamfer parameters are `{ participants: [{ role: "edge", targets:
[<edge ref>] }], options }`, with one supported width form:

- `{ widthForm: "equalOffsets", distance: 1 }` (the width form may be omitted).
- `{ widthForm: "twoOffsets", distance1: 1, distance2: 2 }`.
- `{ widthForm: "offsetAngle", distance: 1, angle: 30 }`.

Distances are in document units; chamfer angles are **degrees**, strictly between
0 and 90. Scalar fields also accept canonical authored wrappers. Width variants
must be explicit literals, not unresolved expressions. Unknown roles, unknown
options and inactive variant fields are refused rather than silently discarded.
Native two-offset/distance-angle execution retains production adjacent-face
ordering; an edge reference does not select an owner face or reverse the widths.

Edge refs are `{ kind: "edge", bodyId, edgeId }` from current discovery, not
subshape indices. Recipes also accept exact unique `{ alias, label }` in
`edgeTargets` and participant `targets`; feature IDs accept the existing feature
label aliases. An old discovery may describe the input to an existing feature
update, but cannot certify a consumed edge as a current new selection.
Rediscover after each operation. Missing, stale, unsupported subtopology and
infeasible inputs cannot fulfill a treatment. Existing production refusals may
be unchanged execution failures; accepted invalid rebuilds retain applied live
state and persistence truth, with failed geometry (or explicit `author-invalid`
editable state), never an invented successful rollback.

`model.bodies[].topology` exposes the existing native exact-payload signatures
with durable refs, analytic types/defining data and extents from the **same**
payload as `bounds`. A fillet can leave overall body bounds unchanged: inspect
the actual cylinder radius or bevel plane, not bounds alone. Null means exact
inspection is unavailable/invalid, not an empty topology. Body-only mesh outputs
expose no fabricated face/edge/vertex selections and have null exact topology.

## Shell and thicken

`shell.create` / `shell.update` and `thicken.create` / `thicken.update` take
canonical `parameters`, current `basis`, explicit `intent`, and (for updates)
`featureId`. They use the browser's shared parameter preparation and production
create/update path, not raw feature patches.

Shell parameters contain durable `bodyTarget`, positive authored `thickness`,
`direction` (`inside` / `outside`), `faceTargets`, authored `operation`, and
`booleanScope`. Legacy omitted `mode` means `openFaces`:

- `openFaces` requires removable faces belonging to the source body. `newBody`
  with standalone scope retains the source and creates a separate shell;
  `join` / `cut` / `intersect` require explicit target-body scope.
- `closedHollow` requires `faceTargets: []` and `direction: "inside"`.
  It preserves the outer envelope and creates an inward cavity.
- `offsetAllFaces` requires `faceTargets: []` and offsets the whole solid in
  the requested direction.

**Both whole-body modes replace the source body.** They do not execute boolean
composition or create a second body. Their existing canonical operation/scope
fields must be neutral `operation: { source: "literal", value: "newBody" }`,
`booleanScope: { kind: "standalone" }`; other requests are refused rather than
silently ignored. This metadata does not change their replacement behavior.

Thicken parameters contain `participants: [{ role: "face", targets: [...] }]`,
optional authored `operationIntent` (`create`, `add`, `subtract`, `intersect`),
and `options: { thickness: <positive authored number>, side: <authored
"oneSide" | "symmetric">, direction: "positive" | "negative" }`. Source targets
must be faces **or exactly one sheet body**, never mixed or multiple bodies.
A solid body is not a sheet source. Symmetric thickness is the total band,
half on each side, not twice the entered thickness. Boolean intents require
one additional `targetBody` participant with explicit solid targets; create
cannot carry ignored target bodies.

Recipes support exact unique `{ alias, label }` discovery references in shell
`bodyTarget` / `faceTargets` and thicken participant targets. Boolean scope body
IDs remain typed discovered IDs. Re-discover after each edit: unavailable or
consumed subtopology is not replaced with a guessed face. Infeasible offsets,
invalid thickness, participants and missing scopes/output fail through existing
production rules. Applied/persisted invalid geometry is not fulfillment; only
explicit `author-invalid` can accept editable invalid state. Inspection exposes
native analytic topology for checking cavities and offset planes, not just
unchanged outer bounds.

## Holes

`hole.create` / `hole.update` take canonical `parameters`, a current `basis`,
explicit `intent`, and an existing `featureId` for updates. Holes are implicitly
subtractive; there is no separate boolean operation intent. Participants are
`[{ role: "location", targets: [<sketchPoint refs>] }, { role: "body", targets:
[<solid body refs>] }]`. Locations must be current authored sketch points and
inherit their owning sketch plane's normal; `direction: "forward" | "reverse"`
selects its sign. Recipes accept exact unique `{ alias, label }` location/body
references and the existing feature aliases.

Options reuse the browser's canonical hole styles and authored scalar values:

- `style: "simple"` (also the omitted-style default), `mainDiameter`,
  `termination: "blind"`, positive `depth`, optional `direction` (forward by
  default).
- `termination: "throughAll"` omits `depth`; inactive depth input is refused,
  not silently discarded. The existing native owner spans the selected bodies.
- `style: "counterbore"` adds `counterboreDiameter` and `counterboreDepth`.
  The entry diameter must exceed `mainDiameter`; recess depth must be positive
  and smaller than a blind bore's depth.
- `style: "countersink"` adds `countersinkDiameter` and
  `countersinkAngleDegrees` (included angle, strictly between 0 and 180).
  The entry diameter must exceed `mainDiameter`; its cone must fit a blind bore.

Unknown/inactive style fields, unsupported targets, unresolved style/direction/
termination variants and implicit scopes are refused rather than coerced by
browser transition defaults. Diameter/depth expressions use the existing
production expression resolver. Sheet targets and infeasible dimensions refuse
through existing native rules. Missing/deleted locations can persist an invalid
editable feature, but never count as fulfillment; only explicit `author-invalid`
can accept that state. Native topology exposes cylindrical radii/axes, conical
angles and cut extents for independent inspection; unchanged outer bounds alone
do not prove a hole exists.

## Sweeps

`sweep.create` and `sweep.update` take current `basis`, `intent`, canonical
`parameters`, and (for update) a discovered `featureId`. Parameters contain
`participants` with exactly one `profile` (one current region or planar solid
body face) and one `path` (one current solid-body edge or sketch entity), and
`options: { profileControl: "none", twist: { type: "none" }, endScale: 1 }`.
Scalar values retain the shared authored literal/expression forms. Recipes
accept exact unique discovered-label aliases for participant targets and update
feature IDs; missing/ambiguous labels fail, unknown aliases are usage errors.

Ordinary paths use the production pipe builder, including supported sketch
lines, arcs, circles and splines. Supported profile controls are `none`,
`lockProfileFaces` (requires `lockProfileFace` planar
solid-body face targets), and `lockProfileDirection` (requires exactly one
`lockProfileDirection` linear solid-body edge or construction-plane reference).
Face locks use the first selected planar face's normal, after validating all
selected faces; direction constructions use their plane normal. These controls
use the existing native trihedron modes, not arbitrary guide geometry.
`keepProfileOrientation` is explicitly refused: the existing native MakePipe
call silently falls back from its fixed trihedron mode, so it does not provide
the promised fixed orientation. No new native implementation is included. Inactive
lock targets, duplicate roles, extra paths and unknown controls are refused
before browser hydration can discard or default them.

Non-unit positive `endScale` and twist variants require a **durable linear
solid-body edge**, not a sketch-entity path. Twist is `{ type: "angle", angle }`
in RADIANS, `{ type: "turns", turns }` with positive turns, or
`{ type: "pitch", pitch }` with positive document-length pitch. The latter
converts path length / pitch to turns. These native controls construct a
**two-section endpoint loft**, transforming the end profile by scale about the
path start, rotation about the path axis, then path translation. They are NOT
a continuous helical sweep: whole-turn endpoint rotations are periodic and do
not imply material winding between sections. Profile controls cannot combine
with effective twist/scale. Guides and boolean composition are unsupported;
no new geometry algorithm is implied. `operationIntent` defaults to create.

Completion uses the same production mutation, exact repository receipt, rebuild
and handoff as other features. Missing references may leave an applied, committed
but failed-editable feature; strict intent never reports that as fulfilled.
Inspect the sweep feature's `producedTargets` to choose its actual current body,
not a retained body used as the path tool. Native topology is current exact
geometry, not a last-good mesh or a body-count certificate.

## Lofts

`loft.create` / `loft.update` take current `basis`, `intent`, canonical
`parameters`, and a discovered `featureId` for updates. `participants` contains
one `profile` role with **at least two ordered** current regions or planar
solid-body faces. Order is preserved, never sorted. Region profiles with inner
loops are unsupported. Optional `operationIntent` supports only literal `create`;
boolean composition is refused. Recipe participant/feature aliases use exact
unique discovered labels, with the same missing/ambiguous/unknown alias policy
as other features.

The optional `path` role requires **exactly two profiles and at most one durable
linear solid-body edge**. Sketch entities and curved edges are not supported.
`options: { path: { sectionCount: 3 } }` accepts positive integers and existing
authored expressions; the default count is 5. Inactive path settings are refused.
The existing native algorithm inserts that many translated **start-wire copies**
at `edgeDelta * i / (sectionCount + 1)`, between the actual start and end wires.
Only the edge delta is used, not its origin. This is not a curved-centerline loft
or an interpolation of changing profile sizes along the path. The final wire is
the actual end profile, which may differ in size/shape.

Guide participants, guide continuity, endpoint conditions/magnitudes and match
connections are excluded/refused, including explicit neutral values: the native
owner currently only validates/resolves them and does not apply them to geometry.
Neutral defaults added internally by the shared browser builder do not imply
those capabilities. Engine follow-up is separate; no new loft algorithm is added.

The shared browser hydration/build and production mutation path retain exact
persistence/rebuild/handoff/failure semantics. An applied committed feature with
missing references can remain failed-editable, never strictly fulfilled; only
explicit `author-invalid` accepts invalid geometry. Inspect the feature's actual
`producedTargets`, not retained tool bodies. Existing exact native B-rep B-spline
edge records now include poles, degree, knots/multiplicities, weights (if rational)
and parameter ranges in `topology[].definingData`; these are actual curve data,
not sampled display geometry. Endcaps and bounds alone cannot prove path-loft
interiors or effective section counts.

## Body booleans, splits and Delete Solid

`combine.create` / `combine.update`, `split.create` / `split.update` and
`deleteSolid.create` / `deleteSolid.update` take current `basis`, explicit
`intent`, canonical `parameters`, and (for updates) the existing `featureId`.
Participant body targets and feature IDs accept exact unique recipe label
aliases. Duplicate roles/bodies, overlapping target/tool sets, unknown roles
and unsupported inputs refuse before browser hydration can discard them.

- Combine requires nonempty `targetBody` and `toolBody` participant sets of
  current **solid** bodies and literal authored `operationIntent` `add`,
  `subtract` or `intersect`. Unresolved intent expressions refuse. Native
  subtraction/intersection apply all tools sequentially to each target.
  Addition merges all targets and tools into the **first target** identity;
  other target bodies disappear even when tools are retained.
  `options.keepTools` is an optional literal boolean, default **false**.
- Split requires exactly one solid `targetBody` and one distinct solid or sheet
  `toolBody`. Plane splitting and all operation intents are unsupported.
  `options.keepTools` defaults **true**; only literal false consumes the tool.
  The original target is invalidated and new result solids are discovered from
  actual feature outputs, with existing native split-history behavior unchanged.
- Delete Solid requires one nonempty unique `body` participant set of current
  solids, with no options or operation intent. It authors a **history feature**,
  not removal of the target's producer or of a feature record. Its
  `producedTargets` is correctly empty. Deleting that history feature restores
  upstream geometry. Completion requires exact current rebuild, native deletion
  invalidations and absent requested bodies, while applied at the rollback
  cursor; absence alone is not success. Native missing-body refusals remain
  non-repairable even with `author-invalid`, including formerly valid bodies
  whose producer was removed. No missing-body deletion is certified.

Rediscover current references after every operation. Consumed/deleted targets
must not be reused as current topology. Unsupported geometry may refuse before
commit; accepted edits with failed regeneration remain applied and persisted,
not fulfilled. Only explicit `author-invalid` accepts editable invalid state.
No CLI boolean algorithm, body-array mutation or alternative native history
owner is introduced.

## Body mirrors, transforms and copy patterns

`mirror`, `transform`, `linearPattern` and `circularPattern` each provide
`.create` and `.update` with current `basis`, explicit `intent`, canonical
`parameters`, and `featureId` for updates. Participant references and feature
IDs accept exact unique recipe labels. `model.capabilities` forwards the same
production kernel capability declaration used by the browser: mirror and
transform execution are supported, but neither is advertised as previewable.
No CLI capability override is used.

- Mirror requires nonempty unique solid `body` targets, exactly one `plane`
  (construction plane or planar solid face), and `options.copy: true` (also
  accepts existing authored wrappers). Ordinary copies retain their seeds and
  have new body identities. The only supported explicit operation intent is
  literal authored `add`, with exactly one seed and exactly one `targetBody`
  referencing **that same body**; this merges into the original identity.
  Replace, other intents, and arbitrary merge scopes are unsupported.
- Transform is in-place on unique solid `body` targets and preserves body IDs.
  Translation takes either `options.vector: [x,y,z]` (finite, nonzero), with no
  reference or inactive options, or one `transformReference` (construction or
  planar solid face), positive `distance`, and optional `direction` `positive`
  (default) or `negative`. Distance accepts existing authored expressions.
  Rotation takes `transformType: "rotation"`, nonzero literal `angle` in
  **degrees**, and one `axis` (construction/planar face normal, linear solid
  edge, or sketch line). Literal angle wrappers are accepted; angle expressions
  are not resolved by the existing native owner and are refused. No boolean
  intent, mixed translation/rotation fields, or fallback from an invalid vector
  is accepted.
- Patterns are **copy-only bodies**, not face/feature patterns or replay.
  `linearPattern` takes one explicit `direction`; `circularPattern` takes one
  `axis`. Both accept construction/planar face normals, linear solid edges or
  sketch lines. `instanceCount` is an integer >=2 **including each seed**;
  seeds remain unchanged and only count-1 copies per seed are feature outputs.
  Linear `spacing` is positive and `oppositeDirection` reverses it. Centered
  patterns and operation intents are refused. Circular `angleDegrees` is
  nonzero with magnitude <=360; `equalSpace: true` divides a full turn by count,
  otherwise by count-1 including the partial endpoint. With `equalSpace: false`
  the angle is the per-instance step. `oppositeDirection` reverses the signed
  angle. Pattern count, spacing, angle and booleans use existing authored-value
  resolution. Copied topology retains the native conservative producer-stage
  policy; exact geometric inspection does not promise durable subshape naming.

Unknown/duplicate roles, duplicate bodies, extra references and inactive fields
are refused before shared browser hydration could drop them. Rediscover current
references after edits. Strict accepted mutations with failed regeneration are
applied and persisted but report failed geometry, never last-good success;
explicit `author-invalid` may retain editable invalid state. Native pre-commit
refusals remain unchanged and are not converted into fabricated edit receipts.

## Supported extrusion-operation replay

`featureReplay.create` and `featureReplay.update` take the current `basis`,
explicit `intent`, canonical `parameters: { sourceFeatureIds, transform }`, and
`featureId` for updates. Sources are ordered, nonempty, unique **earlier feature
IDs**, not bodies or faces. Recipe source IDs, transform references and update
feature IDs accept exact unique `{ alias, label }` selections. Canonical
extrude/revolve `booleanScope: { kind: "targetBody", bodyId }` also accepts a
body label alias in recipes; this resolves an exact body, never an inferred scope.

Only solid extrusion **join/cut** operations with an exact `targetBody` lineage,
or earlier supported replay features, are replayable. New-body/sheet/intersect
extrusions and other feature families are unsupported. This re-executes each
source operation tool against its original target lineage, not a generic
feature/body/face pattern. Original operations remain; produced targets identify
the affected existing bodies rather than new body copies.

- Linear transform: `{ kind: "linear", direction, instanceCount, spacing,
  oppositeDirection }`. `direction` must be a construction plane (its normal);
  count is an integer >=2 including the original, spacing is positive, and
  opposite reverses direction. Count/spacing use canonical authored values and
  support existing numeric expressions. Opposite must be a **literal authored
  boolean**; the existing shared normalizer refuses boolean expressions.
- Mirror transform: `{ kind: "mirror", plane }`, construction plane only.
  Nested replay applies each source's **local transform before the outer
  transform**, preserving source order and exact target-body lineage.

Unknown/inactive fields are rejected by the exact semantic validator. Shared
production normalization and the existing native replay owner validate source
availability, operation kinds, transforms and dependencies. Stale bases conflict;
pre-commit refusals do not mutate state. An accepted update with missing source
or construction reference can persist with failed regeneration: strict mode
reports failed geometry, not last-good bounds/topology. Explicit `author-invalid`
may retain editable invalid state. Rediscover references after changes; deleting
an earlier source can invalidate downstream replay. Conservative native replay
provenance is unchanged; inspection does not promise durable subshape naming.

## Active-author undo and redo

`history.inspect`, `history.undo`, and `history.redo` take the current `basis`
and `draft`: a current draft basis (or its recipe alias) while editing a sketch,
otherwise `null`. Discovery exposes the active owner's undo/redo entries and
availability. Undo/redo may take an explicit `actionSequence`; omitted means
the newest available action. Empty private history never falls through to
document undo. Document actions use author-scoped repository compensation and
await exact synchronization and editor rebuild/handoff; peer edits are preserved
and overlapping actions are refused. Cursor movement is not authored-action undo.
Publication is one document action. Failed persistence can still have applied
live state, and is reported separately. Fresh file opening resets both owners;
saving does not persist process-private history for another invocation.

## Geometry and sketch export

Discovery's `exportProviders` comes from the same production registry used for
execution: format, label, extension, MIME type, target kinds and default options.
Every export takes the current `basis`, a discovered `target`, output `path`, and
closed `options` (unknown fields are refused):

| Operation | Target | Options |
| --- | --- | --- |
| `export.step` | body | `{ schema: "AP242" \| "AP214" \| "AP203", unit: "millimeter" }` |
| `export.stl` | body | `{ meshAccuracy: { chordTolerance: 0.05, angleToleranceRadians: 0.1 }, encoding: "binary" \| "ascii" }` |
| `export.3mf` | body | `{ meshAccuracy: { chordTolerance: 0.05, angleToleranceRadians: 0.1 }, unit: "millimeter", includeMetadata: true }` |
| `export.svg`, `export.dxf` | committed sketch | `{}` |

Mesh tolerances must be positive finite numbers, in model millimeters and radians.
3MF's `includeMetadata` is a boolean controlling the target-label Title metadata.
STL and 3MF use the native production mesh exporter, not viewport/display meshes.
Binary STL and ZIP-based 3MF are written as bytes without UTF-8 conversion.

A recipe may select an exact unique reference label with
`{ "alias": "solid", "label": "<discovered body or sketch label>" }`;
feature labels are not body/sketch labels. Re-discover after editing; stale bases,
missing targets, incompatible target kinds and invalid options are refused.
Vector export uses existing solved sketch geometry, omits construction entities
and nonaccepted/broken derived output, and forwards diagnostics. The existing
providers support lines, circles, arcs, splines, Béziers and conics. Unsupported
points, ellipses, elliptical arcs and profile text are skipped with warnings;
no exportable geometry is a provider failure. SVG includes resolved region paths
and styles; DXF emits entities, approximates curves with polylines, and does not
export region fills. These are existing provider limitations, not new translators.

Completion includes the provider result and the actual file write/sync/close.
Export is distinct from `document.save`: it does not save editable native history,
mutate authored state, or invent a repository commit receipt. Failed writes retain
the observed byte count independently of valid geometry; a sync/close failure is
still a file failure even when all payload bytes were written.
