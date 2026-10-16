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

### Feature lifecycle and rollback timeline

The following operations require a current `basis` and explicit `intent`
(`fulfill` or `author-invalid`) in document context, outside a private sketch:

- `feature.suppression.set`: `featureId`, `suppressed` boolean; restoration
  uses `false` and preserves the feature identity.
- `feature.delete`: `featureId`; removes the authored feature.
- `feature.reorder`: `featureId`, `beforeFeatureId` (null appends).
- `body.rename`: `bodyId`, `label`; preserves body identity and geometry.
- `target.delete`: a typed durable `target`; uses production supported-target
  deletion semantics (deleting a body authors a `deleteSolid` feature).
- `timeline.cursor.set`: `cursor` is `{ kind: "empty" }`,
  `{ kind: "sketch", sketchId }` or `{ kind: "feature", featureId }`.
- `timeline.reorder`: typed sketch/feature `item` and `beforeItem` (null appends).

Discovery `model.features` includes actual suppression state and produced
identities; `model.cursor` and `model.timeline` describe the current authored
rollback position/order. Cursor movement changes evaluated geometry without
removing later feature records. It is **not** author-scoped `history.undo` or
`history.redo`, nor replay of private history. Native files retain authored
suppression, body labels and cursor, not the process's undo stack.

Recipes accept exact unique `{ alias, label }` references for `featureId`,
`beforeFeatureId`, `bodyId`, `target`, `cursor`, `item` and `beforeItem`, using
references from that alias's discovery. Null anchors remain null. Missing or
ambiguous labels fail before the operation; unknown aliases are usage errors.
Dependency-invalid orders, unsupported/deleted targets and stale bases refuse.
Accepted edits still require an exact persistence receipt, rebuilt geometry and
current handoff. Invalid downstream geometry is not fulfillment; only explicit
`author-invalid` can accept it as editable invalid state. A write failure does
not imply rollback of an already applied live edit.

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

### Durable sketch patterns and transforms

`sketch.derivation.create` takes current `basis`/`draft`, distinct owned
entity `targets`, `kind: "linearPattern" | "circularPattern" | "transform"`,
a finite positive numeric `value`, and `intent`. Seeds use exact unique
discovered-label aliases in recipes. Missing/ambiguous labels fail before the
operation; unknown aliases are usage errors before runtime startup.

These are the current browser builder's supported settings, not arbitrary
schema construction: linear pattern creates ONE additional instance translated
by `[value, 0]`; circular pattern creates ONE additional instance rotated by
`value` RADIANS about `[0, 0]`; derived transform creates ONE additional copy
translated by `[value, 0]`, with origin `[0, 0]`, rotation zero and scale one.
They support points, lines, circles, bound arcs and ordinary splines, preserving
shared point identities and construction flags. Unsupported curves and offset
spline shells refuse. No direction/center reference, arbitrary instance count,
rotation/scale setter or post-creation numeric setter is exposed: the browser
has no such authoring owner. Scalar settings are creation inputs. Derived
transforms are NOT direct `sketch.geometry.update` moves.

One authored action creates each durable relationship. Source point/body/radius/
requirement edits use the existing edit/solve owners and refresh derived copies;
chains reuse those same production dependencies. Undo/redo and publication/
reopening preserve relationship and copy identities. Deleting a needed seed
can invalidate the solve and block publication/profile use rather than serving
last-good geometry. This does not invent detach, automatic rebinding or repair.

Discovery `sketch.derivations` exposes the authored relationship record with
settings and seed/output identities, `profileGateFailed` from the production
failed-derivation list, and accepted solved `currentGeometry` (null when that
relationship fails the gate OR the live solve is unaccepted). Missing-seed
diagnostics can invalidate a solve without appearing in that narrower list;
inspect sketch validity/diagnostics too. Authored entity/point records remain
distinct from current geometry. Completion awaits correlated solve/native
region derivation, and profile validity remains production-owned.

### Sketch supports and external references

`sketch.begin` takes current `basis` and either `plane: "xy" | "yz" | "xz"`
or an explicit `support` construction/face reference. Discovery supplies real
construction and native body topology targets; unknown constructions, missing
faces and nonplanar faces refuse. The existing support owner supplies the actual
origin/axes/normal in document-length units and a right-handed frame. Face-backed
supports have `plane: null`; use `sketch.support`, not a guessed standard plane.

`sketch.support.reassign` takes current `basis`, a committed `sketchId` and
explicit `support`, outside a private draft. It uses the browser's committed
plane-edit/cursor workflow, preserving geometry IDs and sketch-plane coordinates.
The support must exist after rollback to the edited sketch; its own downstream
faces are not eligible. Cancellation/refusal restores the cursor through the
same owner. A tail same-support no-op has no write. A non-tail no-op can advance
the revision through real rollback/restoration writes without adding an authored
action. Those applied basis changes are reported, not hidden as an unchanged
transaction. Missing or failed exact persistence receipts never certify a commit;
already applied live state is not promised to roll back.

`sketch.reference.add` takes current `basis`/`draft`, `intent`, and a typed
external `target`: construction, face, edge, vertex, sketch, sketch entity or
sketch point. It shares reference authoring, native projection, solve and region
completion with the browser, creating one **Reference Geometry** private action.
Self, duplicate, unavailable and stale targets refuse. Model edges/vertices use
normal-direction projection; a collapsed vertical edge can be unsupported.
Faces and sketch sources require coplanarity. This is not a new projection
algorithm or arbitrary topology-correspondence guarantee.

Discovery `sketch.references` separates authored definitions from actual
projection records (`projected`, `missingSource`, `unsupportedSource`,
`outOfPlane`, `ambiguous`) and diagnostics. `revisionId` identifies the document
basis used for that projection, not a per-source timestamp; it is null when no
projection record is available. Successful records expose read-only operands in
`sketch.operands`, never editable local entities. Source publication/reopening
refreshes those records through production restoration; source deletion exposes
missing-source diagnostics, not old geometry. Runtime projection failure clears
old external operands and fails the geometry barrier. Unresolved references do
not fulfill a geometry request even when there are no local entities. Explicit
`author-invalid` can retain structurally authored invalid drafts; it cannot turn
a runtime failure into success. Existing requirement operand combinations still
apply: exposing a projected circle does not enable single-circle diameter sizing
or local/projected point-pair sizing where the registry does not support them.

Recipes accept exact unique discovered-label aliases for `support`, `target`
and reassignment `sketchId`. Missing/ambiguous labels stop that operation; unknown
aliases are usage errors before startup. Native files retain supports and authored
reference identities, not session-private history or arbitrary topology remapping.

### Sketch styles and raster reference images

All style/image commands take current `basis`/`draft` and explicit `intent`.
`sketch.style.patch` takes nonempty owned `targets` and one `{ field, value }`
patch. Fill targets are current enclosed regions; stroke targets are local
entities. Fields follow the existing style owner: `fillMode` (none/solid/gradient),
`fillColor`, `gradientStartColor`, `gradientEndColor`, `strokeEnabled`,
`strokeColor`, `strokeWidth`, `strokeCap` (butt/round/square), `strokeJoin`
(miter/round/bevel), `strokeMiterLimit`, `strokeDashSize`, `strokeGapSize`.
Numeric stroke values are finite and nonnegative; widths/dashes/gaps are the
existing SVG pixel values, not model dimensions. Color strings retain the
browser's policy (including CSS variables), not a new color parser. Styles
preserve geometry and current profiles. A changed patch is one **Sketch Style**
action; an unchanged patch adds no action. Discovery exposes entity `style`
and authored region `sketch.styles` records. No rendering toggle is required.

`sketch.image.add` takes a local `path`. The filesystem adapter supplies bytes
and filename to the same payload preparation used by browser imports, without
pickers, DOM, browser image APIs or new decoders. Existing PNG, JPEG, BMP, WebP
and TIFF metadata readers supply pixel dimensions; TIFF metadata is supported
by the existing reader even though the browser picker advertises only the other
formats. Dimension metadata is not a pixel-decoding or complete-file-integrity
certificate. Invalid/absent dimensions, unknown extensions and unreadable files
fail before authoring. Bytes are retained inline, base64-encoded, in the existing
native document format; no new asset archive is created.

Discovery exposes authored `sketch.referenceImages` and typed `sketchOperation`
targets. Images start centered at `[0,0]`, rotation zero, with longest extent 200
in sketch/document units and the original aspect ratio. `sketch.image.update`
takes an owned image `target` and either `{ kind: "placement", placement: {
center, width, height, rotationRadians } }` (positive finite extents) or
`{ kind: "settings", scaleMode: "lockedAspect" | "independent",
showExportedAnchorsInSketch: boolean }`. Settings/placement use the existing
calibration solver and owned-state update; existing anchor bindings can constrain
the recovered placement. This does not create anchors or new calibration geometry.
`sketch.image.replace` takes `target` and local `path`, preserving operation
identity and calibration through the existing replacement owner.
`sketch.image.remove` takes `target` and uses the shared deletion owner, including
owned anchor geometry and requirements. Each changed intent is one private
undoable action. Images do not create consumable profiles; validated image-only
sketches may publish/save without manufacturing curves or native faces.

Recipes accept exact unique discovered-label aliases for style `targets` and
image `target`. Missing/ambiguous labels fail, unknown aliases are usage errors.
Native save/open retains styles, bytes, placement and calibration—not private
history. File and repository failures remain separate from actual live changes.

### Document variables and expressions

`variable.add` takes current `basis`, identifier-style `name`, `valueText` and
`intent`. `variable.update` additionally takes the discovered `variableId` and
supplies the complete new name/value text. These are document-context operations;
finish or discard a private sketch first. Discovery `variables` exposes the actual
authored IDs, names and expression text. No variable-delete command is invented.
Recipes may select `variableId` by `{ "alias": "parameters", "label": "height" }`,
matching an exact unique variable name in that result. Unknown aliases are usage
errors; missing/ambiguous names fail the operation.

Expressions use the production scalar evaluator, including arithmetic, dependency
chains and supported math functions/constants (for example `sqrt(81) + sin(pi / 2)`).
They must resolve to finite real numbers: assignments, unresolved symbols, cycles,
duplicates, invalid names and unit-valued results such as `2 cm` are refused before
writing, even with `author-invalid`. Values are scalar model-unit inputs, not a
new dimensional-unit conversion language: lengths use document millimeters and
angle expressions use radians.

`sketch.dimension.update` accepts a numeric value or expression string through the
same annotation normalizer used by browser edits; numeric angle updates remain
in degrees. Dimension/requirement creation still uses numeric inputs; update the
discovered dimension to author an expression. `extrude.create` and `extrude.update`
accept numeric or expression `depth` through the shared browser feature form
preparation. No independent expression setter is added to offsets or unsupported
feature families.

Variable changes await the production dependent solve/rebuild and authoritative
handoff. An accepted variable that invalidates a sketch or feature reports applied
state and failed geometry, never current last-good output; explicit
`intent: "author-invalid"` reports invalid-editable output instead. Repository
commitment, runtime acceptance and file saving remain separate. Native save/open
retains authored expressions and dependency identities, and subsequent edits
rebuild them; it does not retain private session history.

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

### Extrusion variants and rebuild

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

Recipe `parameters.profiles` also accepts exact unique label aliases; nested
start/end targets and boolean body IDs currently require typed discovered
references. Up-to-next must prove complete termination of the swept profile,
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

### Revolve solids and sheets

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

### Construction planes

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

### Solid edge treatments

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

### Shell and thicken

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

### Holes

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

### Sweeps

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
