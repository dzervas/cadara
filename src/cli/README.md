# cadara CLI

`cadara` is the general-purpose command-line tool for the CADara project. It
runs under Bun/Node (never in the browser) and shares contract and domain code
with the app but never imports browser-bound modules.

```
cadara <group> <command> [args]
```

Exit codes: `0` success, `1` command failure, `2` usage error.

## Running

```bash
bun run cli -- <group> <command> [args]
# or, once linked as a bin:
cadara <group> <command> [args]
```

## `document recipe`

Run sequential native document operations against an isolated editing context:

```bash
bun run cli -- document recipe recipe.json
bun run cli -- document recipe --help
```

```json
{
  "version": 1,
  "operations": [
    { "version": 1, "commandId": "create", "operation": "document.create", "label": "Bracket", "basis": null, "as": "part" },
    { "version": 1, "commandId": "inspect", "operation": "document.inspect", "basis": { "alias": "part" } }
  ]
}
```

Command IDs and aliases are unique within the recipe. Inspection also accepts
an explicit `{ documentId, revisionId, repositoryHeads }` basis; stale bases are
refused. Basis aliases resolve only from authoritative result states, never
labels or list order. Stdout is one JSON envelope containing correlated semantic
results, unexecuted command IDs and awaited cleanup. Errors use stderr and the
shell's existing 0/1/2 policy. Execution stops at the first failed operation;
prior changes are not rolled back. Each invocation owns a separate document.
Repository commitment is not a disk save. `document.rename` takes `label` and
a current `basis`; it may define a new alias with `as`. `document.save` takes
`path` and a current `basis`, and completes only after writing, synchronizing
and closing the native file. `document.open` takes `path`, `basis: null`, and
may define an alias. It uses the current native JSON format and retained assets,
with a fresh editing context and no restored private undo history. Read/write
failures are command failures; applied live state and failed saving remain
separate in the result. Saving is not atomic and partial bytes are reported.
For example, append `{ "version": 1, "commandId": "save", "operation":
"document.save", "path": "bracket.cadara", "basis": { "alias": "part" } }`.
Help, capture and invalid recipes do not start the modeling runtime.

### Round sketch primitives

`sketch.author` takes current `basis` and `draft`, `construction`, `intent`, and
one `primitive`:

- `circle`: `center`, positive `radius`.
- `threePointCircle` / `threePointArc`: exactly three distinct non-collinear
  `points` (arc order: start, through, end).
- `centerPointArc`: `center`, `start`, `end`; counter-clockwise with a nonzero
  sweep. Endpoint bindings retain the browser tool's circular-arc solve rules.
- `tangentArc`: `start`, nonzero `direction` vector, `end`, and `source` (null
  for a free direction or an owned `sketchEntity` reference). A source authors
  structural tangency and start-on-source requirements. Line/circle/arc sources
  are supported; centers and construction line/arc endpoints are not sources.
- `inscribedPolygon` / `circumscribedPolygon`: `center`, positive `radius`
  (circumradius / inradius). Both use the production six-sided, fixed-orientation
  tool and its construction circles and regularity requirements.

Coordinates are in document units. Degenerate round inputs are refused, including
with `author-invalid`; no empty contribution is reported as fulfilled. Geometry,
identities, solving and current profiles use the browser's contribution owner.
Open arcs have no consumable closed profile; equal coordinates alone do not
establish shared endpoint identities. Construction primitives do not create profiles.
Recipes may select a tangent `primitive.source` by exact unique
`{ "alias": "source", "label": "Line 1" }`; missing/ambiguous, foreign, deleted,
or stale sources fail closed. Re-discover after each command.

### Advanced sketch curves

Advanced `sketch.author` primitives reuse the production browser tools:

- `ellipse`: three `points` (center, major-axis endpoint, minor-sizing point).
- `ellipticalArc`: five `points` (center, major-axis endpoint, minor-sizing
  point, start, end), with the production counter-clockwise sweep.
- `conic`: three `points` (start, control, end), with production rho `0.5`.
- `bezierCurve` / `controlPointSpline`: exactly four distinct `controlPoints`.
  Both create the production cubic Bézier representation, not an interpolating
  ordinary spline; no extra degrees or knot settings are implied.
- `spline`: `fitPoints` (at least two), through which the ordinary spline
  interpolates. Its automatic tangents use the canonical reconstruction owner.
- `profileText`: `anchor`, `heightPoint`, nonempty `text`, `horizontalAlign`
  (`left`, `center`, `right`) and `verticalAlign` (`baseline`, `middle`, `top`,
  `bottom`). The second point sizes height and rotation; it is not an authored
  point or a glyph outline.

Discovery exposes authored minor radii, sweep directions, conic rho, Bézier
degree, ordinary-spline closure and text settings. Point moves and entity
translations use the existing constrained edit owner; ordinary-spline tangent
edits address distinct typed tangent handles, not fit points. There is no
production parameter-edit UI owner for changing text content, conic rho,
Bézier degree or minor radius independently, so these are creation settings,
not invented edit commands.

`sketch.geometry.update` also accepts `edit: { kind: "mergePoints", target,
destination }`, with two owned point references (or exact unique recipe label
aliases). The destination keeps its ID and position; references follow it.
Merging an ordinary spline's own end points closes it positionally when it has
at least four fit-point occurrences. Undo restores the open identities. Equal
coordinates alone do not close it, and collapsing another curve's own ends is
refused. No arbitrary smooth-closure variant is added.

The production region owner currently has **no consumable region form** for
ellipse, elliptical arc, conic, Bézier/control-point spline or profile text.
Their geometry can be authored and edited, but diagnostics explain unsupported
profiles, discovery returns no face, and `requireProfiles: true` publication
is refused. Text preview is not native glyph geometry. Do not infer extrusion
or export support from a registered tool or successful authoring; requested
exports still use their provider's target/capability gates. Ordinary splines
can produce profiles only when the production closure and native query gates
succeed. Degenerate advanced inputs are refused even with `author-invalid`.

### Exact sketch intersection edits

`sketch.geometry.update` additionally accepts `edit`:

- `{ kind: "trim", target }`: line, arc, circle or ordinary spline. The
  production trim removes the interval between the first and last crossings
  of all other local curves (construction included); a circle/closed spline
  instead keeps that interval in source traversal. This is not arbitrary
  clicked-segment removal. Projected geometry is not a cutter.
- `{ kind: "split", target, boundary, pick: [x, y] }`: line, arc, circle or
  ordinary spline cut by one of those same curve kinds. `pick` selects the
  nearest crossing (a circle needs two). Equally near or uncertifiably ordered
  choices refuse; choose a point nearer the intended crossing.
- `{ kind: "extend", target, boundary }`: a line extended to the infinite line
  of a local line boundary. The production query chooses the nearest eligible
  end; no crossing or an ambiguous end refuses. Curved extension is unsupported.

Target/boundary are owned entity references or exact unique recipe label
aliases. Current `basis`, `draft`, and `intent` remain required. Edits reuse
browser query gates and mutation builders, including derived-input refusals,
requirement migration and identity allocation. Radius requirements on a circle
becoming arcs retain their ID as diameter requirements with doubled value;
arc endpoint bindings are rebuilt. One completed edit is one private action.
Undo restores the original records. Rediscover resulting references after an
edit; unchanged labels alone do not promise unchanged geometry.

A successful geometry receipt includes `editQuery` (request ID and queried
prior draft generation), final `solve`, and final `derivation`. Missing,
unsupported, stale, ambiguous or no-crossing inputs cannot report applied
geometry. Profile availability comes from the final production derivation,
not from the query alone. Explicit point merges keep the existing shared
`mergePoints` operation described above.

### Sketch corners and slots

`sketch.geometry.build` takes current `basis`, `draft`, owned entity
`targets`, `intent`, and one construction input:

- `kind: "fillet", radius: <positive number>`: two adjacent, non-collinear
  local line segments; trims the corner and adds a tangent, endpoint-bound arc.
- `kind: "chamfer", distance: <positive number>`: the same two-line corner;
  trims each side by that distance and adds a connecting line.
- `kind: "slot", width: <positive number>`: one line (parallel sides and
  bound semicircular ends), one arc (concentric arcs and **straight radial
  caps**), or one closed line chain (two joined offset loops). Spline, circle,
  projected and open multi-line seeds are not supported.

Values use document millimeters and must fit the selected geometry. Arc slots
require a positive inner radius. Existing mirror/derived-input restrictions
still apply. This is the browser's construction operation, not a new
associative slot or persistent driving radius/width requirement.
Corners retain source entity IDs and existing requirements; fillets and
rounded slot ends add the production endpoint/tangency requirements.
Slots **retain the seed** and inherit its construction flag; they do not
silently delete it or mark it construction. An ordinary retained seed can
partition profiles. Use an explicit `sketch.construction.set` when appropriate.

Each completed construction is one private authored action. Completion returns
the correlated final solve/derivation, diagnostics, current profiles and
discoverable entity/requirement identities. Infeasible, unavailable, duplicate,
foreign or stale targets never imply successful construction.
Recipes accept exact unique entity-label aliases in `targets`; browser picking
and pointer gestures are not semantic inputs.

### Durable sketch offsets

`sketch.offset.create` takes current `basis`, `draft`, distinct owned entity
`targets`, a finite positive `distance` in document millimeters, `side: "left"`
or `"right"`, and `intent`. Exact unique entity-label aliases work in recipes.
The canonical chain owner orders connected local lines, arcs, circles and
ordinary splines; left/right follows that declared traversal, not selection
order or a screen location. Existing identity, join and modeling-tolerance
rules apply. Equal coordinates alone do not declare a connected chain.
Derived spline shells cannot be offset again, and unsupported joints,
collapsed curves, unavailable or uncertified seeds refuse without an action.

Creation waits for the production offset publication (including its one
permitted certified-plan re-authoring) before committing one **Offset** action,
then waits for the resulting live solve/region derivation. Expression resolution
and publication use the same owners as browser previews and Finish Sketch.
Discovery `sketch.offsets` reports durable IDs, ordered seeds, outputs, authored
signed distance and relationship health. `currentGeometry` contains only
current certified solved outputs (including spline cubic spans and driven
terminal points); it is null for checking/broken offsets. The ordinary
`sketch.entities`/`points` remain authored records, not solved offset geometry.
Last-good display curves are never exposed as usable profiles; independent
healthy source regions can still remain consumable when a descendant fails.

Source changes propagate through the production solver. Existing supported
requirements on offset outputs can size the originals and can be edited with
`sketch.dimension.update`; they do not change the relationship's authored
separation. There is no independent browser distance/side/expression setter,
so this command does not invent one. `sketch.offset.remove` takes the current
basis/draft, discovered `derivationId` and `intent`. Recipes can select that
relationship by `derivationId: { "alias": "offset", "label": "Offset 2" }`, using
its exact unique discovered label (never a guessed ID or first match). It uses the browser's
**Remove Offset** owner, removes its outputs/requirements as one action, and
leaves dependent relationships explicitly broken. Private undo/redo restores
relationship/output identities. Publication/reopening retains the relationship.

### Reciprocal sketch mirrors

`sketch.mirror.create` takes current `basis`/`draft`, distinct owned entity
`targets`, a separate `axis` (a local straight line, construction included, or
an owned sketch X/Y datum reference), and `intent`. The production builder
supports points, lines, circles, bound arcs and ordinary splines; unsupported
curves, offset spline shells, unavailable seeds and degenerate axes refuse.
Copies preserve shared point identities and construction flags. One **Mirror**
action creates a durable coupled relationship, not one-way copies. Completion
waits for the correlated live solve and native region derivation.

Edits on either side and requirements use the existing reciprocal solver.
Copy-side requirements can size originals; a second driving dimension for the
same mirrored quantity refuses, so edit the discovered existing driver instead.
Reference dimensions remain measurements. Copy movement preserves a line axis
unless production requirements force it to move; an explicit edit of the axis
is distinct. Conflicts and broken mirror dependencies block profile consumption.

Discovery `sketch.mirrors` exposes relationship IDs/labels, seed/output IDs,
axis references, broken reasons and removal/requirement consequences. Its
`currentGeometry` is solved output geometry, null for a broken relationship or
unaccepted solve. `sketch.entities`/`points` remain authored records, so a repair
need not overwrite their stored output placeholders. No last-good geometry is
advertised as current. Private undo/redo and publication/reopening preserve
relationship and output identities.

`sketch.mirror.repair` takes a discovered `derivationId` and either
`repair: { kind: "axis", target: <straight line or datum reference> }` or
`repair: { kind: "original", output: <owned copy entity>, target: <new seed entity> }`.
The canonical repair owner preserves copy identities, checks kind/spline
fit-count/closure and point-correspondence compatibility, and refuses dependency
cycles. It supports healthy relationships as well as recovery from missing
originals/axes. `sketch.mirror.remove` removes the relationship, its owned copies
and their requirements as one **Remove Mirror** action; dependent relationships
remain broken rather than cascading or being silently rebound. **Mirror Detach
is deferred**, not exposed. There is no invented numeric mirror setting.

Recipes accept exact unique discovered labels for seeds, `axis`, repair
`target`/`output`, and `derivationId`, including datum labels from `sketch.operands`.
Missing/ambiguous labels fail before that operation and leave later operations
unexecuted; unknown aliases are usage errors before runtime startup.

### Private sketch dimensions

`sketch.dimension.add` takes the current `basis` and `draft`, an `axis`
(`horizontal` or `vertical`), two canonical sketch point IDs in `points`,
and either `mode: "driving", value: <positive number>` or `mode: "reference"`.
`sketch.dimension.update` takes `dimensionId` and `value`; updating a reference
makes it driving through the existing annotation owner. Both commands take
`intent: "fulfill"` or explicit `"author-invalid"`. Conflicting requirements are
never fulfilled; explicit invalid authoring remains editable without usable
profiles. Discovery separates `requirements` from solved `measurements`, with
requirement IDs, labels and measured values; document settings retain units and
tolerances.

Recipes may resolve a point or dimension target using `{ "alias": "rectangle",
"label": "Rectangle 1 bottom left" }` or `{ "alias": "width", "label":
"Horizontal distance 2" }`. Only an exact unique match in that immutable result
is accepted; missing/ambiguous labels fail, and current basis/draft checks still
apply. These aliases are CLI-only, never semantic command inputs.

### Complete sketch requirements

`sketch.requirement.add` takes current `basis`, `draft`, explicit typed
`targets`, a `tool`, `mode`, `value`, and `intent`. It uses the browser's
constraint registry, contribution preparation and solver, not tool gestures.

| Tool | Supported operand combinations |
| --- | --- |
| `constraintCoincident` | Two local points; two local lines; local point/curve; local point or circle center with a supported datum/projected point or curve |
| `constraintCollinear` | Local point/line and local, datum or projected line |
| `constraintParallel`, `constraintPerpendicular` | Two local lines, or a local line and datum/projected line |
| `constraintTangent` | Local line/circle/arc with circle/arc; supported local curve with projected circle/arc |
| `constraintEqual` | Two local lines (not equal-radius circles) |
| `constraintHorizontal`, `constraintVertical` | One local line |
| `constraintConcentric` | Two local circles/arcs, or local circle/arc with projected circle/arc |
| `constraintMidpoint` | Local point and local, datum or projected line |
| `constraintNormal` | Local line, local contact point and local/projected circle/arc |
| `constraintPierce` | Local point and supported local, datum or projected curve |
| `constraintSymmetric` | Two existing local points and local, datum or projected line axis; creates no mirror copies |
| `constraintFix` | Supported local point/entity; circles also receive a driving diameter |
| `dimensionDistance` | One local circle/arc (diameter), one local line (length), two supported lines (parallel distance or nonparallel angle), point/line distance, two local points or local point/sketch origin |
| `dimensionHorizontal`, `dimensionVertical` | Two local points or local point/sketch origin |
| `dimensionRadius` | One local circle only; use Distance for an arc diameter |

Constraints require `mode: "driving", value: null`. Dimensions require either
`mode: "driving", value: <positive number>` or
`mode: "reference", value: null`. Angle creation and numeric updates use
**degrees**; authored/discovered line-angle values and measurements are
**radians**. Other numeric values use document millimeters. Reference
measurements never drive geometry.

`sketch.dimension.reference` takes `dimensionId` and changes a supported
numeric requirement to a measurement. `sketch.dimension.update` changes its
value, making a reference driving through the shared annotation owner.
`sketch.requirement.remove` takes nonempty dimension/constraint `targets`.
All three take current `basis`, `draft` and `intent`; each command is one
private authored action, including multi-target removal.

Discovery includes requirement kinds/IDs/values, separate measurements,
constraint kinds/IDs/solve statuses, and current read-only datum/projected
`sketch.operands`. Datum/projected references are operands, not editable
geometry. Only current supported combinations are accepted; unavailable,
foreign, repeated, extra or unsupported operands refuse unchanged. Solver
conflicts report correlated invalid geometry and diagnostics, never fulfilled
geometry or consumable profiles.

Recipes may use exact unique label aliases for requirement `targets`,
removal `targets` and `dimensionId`, including labels in `sketch.operands`.
A point entity can share its point's label: such a generic alias is ambiguous
and must be replaced with a typed reference or a unique authored label.
No implicit proximity, list-order selection or coordinate merging occurs.

### Sketch geometry edits

After `sketch.open`, geometry edits take the current `basis`, `draft`, and
`intent: "fulfill"` or explicit `"author-invalid"`:

- `sketch.geometry.update` takes an `edit`: `point` with a point `target` and
  `position`, `translate` with an entity `target` and `delta`, `radius` with a
  circle/arc entity `target` and positive `radius`, or `tangent` with a typed
  `sketchTangentHandle` target and `vector`. A point destination on the uniquely
  owned center of a circle/arc translates the entire entity, just like a browser
  center grab; other points request minimum-motion edits rather than rigid
  component translation. Explicit `translate` requests the entity's defining
  points together. Fixed requirements may block either intent; constraints and
  driving dimensions remain authoritative. Tangent vectors edit handles, not
  spline fit points, and preserve the fit-point positions.
- `sketch.construction.set` takes a point/entity `target` and `construction`.
- `sketch.geometry.delete` takes nonempty point/entity `targets`; dependent
  requirements are removed by the existing geometry deletion owner.
- `sketch.label.set` takes a sketch, point, entity, dimension or constraint
  `target` and a nonempty `label`. Labels are authored metadata, not overrides.

Discovery exposes canonical point/entity references, defining point IDs,
current circle/arc radii, and spline tangent occurrence IDs. Each edit is one
private authored action; undo/redo, discard, and Publish Sketch use the same
owners as the browser. Constrained/derived targets can refuse an edit. Invalid
editable drafts expose no consumable profiles; publication with
`requireProfiles: true` fails closed. Re-discover after every edit.

Recipes can resolve these `target`, `targets`, and `edit.target` fields using
exact unique `{ "alias": "draft", "label": "Line 1 end" }` selectors.
Tangent edits require the typed handle, including its occurrence and point ID.
Missing, ambiguous, foreign-sketch and stale references are refused.

### Basic solid extrusion and rebuild

`extrude.create` takes a current `basis`, a typed region `profile`
(`{ kind: "region", sketchId, regionId }`), positive `depth` in document units,
and `intent`. `extrude.update` takes the current `basis`, `featureId`, `depth`
and `intent`. They reuse production feature preparation, mutation and rebuild.
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

### Active-author undo and redo

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

### STEP export

`export.step` takes the current `basis`, a discovered `target`, an output `path`,
and `options: { schema: "AP242" | "AP214" | "AP203", unit: "millimeter" }`.
Only existing STEP-provider body targets are supported. A recipe may select an
exact unique body label with `{ "alias": "solid", "label": "<discovered body label>" }`;
feature labels are not body labels. Re-discover after editing; stale bases,
missing targets, unsupported target kinds and invalid options are refused.
Completion includes the provider result and the actual file write/sync/close.
Export does not mutate authored state or invent a repository commit receipt.
Failed writes retain the observed byte count independently of valid geometry.

## `onshape capture`

Capture an Onshape document into a single self-contained, versioned bundle file
(`*.onshape-capture.json`) for later offline import.

```bash
cadara onshape capture <onshape-document-url> [output-file]
```

- `<onshape-document-url>` — the full Onshape browser URL, e.g.
  `https://cad.onshape.com/documents/{did}/w/{wid}[/e/{eid}]`. `w`, `v`, and `m`
  segments are accepted. Without `/e/{eid}`, every Part Studio in the
  workspace/version is captured into one bundle.
- `[output-file]` — optional output path. Defaults to
  `{documentId}.onshape-capture.json`.

The bundle contains, per Part Studio: the verbatim `getFeatures`, solved
`sketches`, `parts`, and (when available) `featurespecs` responses; a resolution
table mapping every referenced deterministic ID to a geometric signature (or a
structured `unresolved` reason); and final-state ground truth (tessellated faces
plus a STEP export). Raw Onshape payloads are archived unmodified — all
interpretation happens later in the import provider.

Capture fails loudly: if any mandatory section cannot be captured after bounded
retries, the command exits non-zero and writes **no** output file. Optional
sections (feature specs) may be absent, and the absence is recorded explicitly.

### Credentials

The command first checks `ONSHAPE_COOKIE_ON`. When set, its value is sent as the
Onshape `on` cookie and API-key variables are ignored. Before the first
cookie-authenticated `POST` or `DELETE`, the client follows Onshape's browser flow
to obtain an in-memory XSRF credential from `/api/clientinfo/xsrf`:

```bash
export ONSHAPE_COOKIE_ON=...       # cookie value; `on=...` is also accepted
```

Alternatively, use an API key pair for HTTP Basic authentication:

```bash
export ONSHAPE_ACCESS_KEY=...      # API access key
export ONSHAPE_SECRET_KEY=...      # API secret key
```

Credentials are never written to bundles, logs, or error output. Generate an API
key pair at <https://dev-portal.onshape.com/keys>. Capture is read-only against
documents the selected credential can access; the client backs off on HTTP 429
and caps concurrent in-flight requests.

Long-running STEP exports can exceed the default poll budget on larger
studios. Set `ONSHAPE_TRANSLATION_MAX_POLLS` to a positive integer to extend
translation polling (500ms between polls):

```bash
export ONSHAPE_TRANSLATION_MAX_POLLS=180
```

## Manual live smoke test (not run in CI)

Automated tests use recorded fixture transcripts with an injected fetch — no
network. To verify real Onshape connectivity manually:

1. Export `ONSHAPE_COOKIE_ON`, or valid `ONSHAPE_ACCESS_KEY` / `ONSHAPE_SECRET_KEY`.
2. Capture a small document you own:
   ```bash
   bun run cli -- onshape capture \
     "https://cad.onshape.com/documents/<did>/w/<wid>" \
     /tmp/smoke.onshape-capture.json
   ```
3. Confirm the command exits `0` and reports the number of Part Studios.
4. Validate the output against the envelope schema (the CLI already validates
   before writing; this is a defense-in-depth check):
   ```bash
   bun -e 'import("@/contracts/import/onshape-capture-bundle").then(async (m) => {
     const fs = await import("node:fs/promises");
     const bundle = JSON.parse(await fs.readFile("/tmp/smoke.onshape-capture.json", "utf8"));
     const r = m.validateOnshapeCaptureBundle(bundle);
     console.log(r.success ? "valid" : r.issues);
   })'
   ```
5. Note the resulting bundle size for capacity planning.

Do not commit captured bundles: they may contain proprietary geometry and are
user-owned files like any other CAD export.
