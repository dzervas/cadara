# cadara CLI: sketch operations

Per-operation fields, units and selector rules for sketch authoring. Shared rules (envelopes, errors, targets, recipe versions) are in [README.md](README.md).

## Round sketch primitives

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

## Advanced sketch curves

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

## Exact sketch intersection edits

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

## Sketch corners and slots

`sketch.geometry.build` takes current `basis`, `draft`, owned entity
`targets`, `intent`, and one construction input:

- `kind: "fillet", radius: <positive number>`: two adjacent, non-collinear
  local line segments; trims the corner and adds a tangent, endpoint-bound arc.
  More than two lines (a chain, or several line pairs) round every corner they
  form, in one action: each end point two targets share where they are not
  collinear and no third target ends; at least one such corner is required.
- `kind: "chamfer", distance: <positive number>`: the same corners; trims each
  side by that distance and adds a connecting line.
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

## Durable sketch offsets

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
permitted certified-plan re-authoring) before committing one **Commit Offset** action,
then waits for the resulting live solve/region derivation. Expression resolution
and publication use the same owners as browser previews and Finish Sketch.
Discovery `sketch.offsets` reports durable IDs, ordered seeds, outputs, authored
signed distance (`{ source: "literal", value }` or an authored expression) and relationship health. `currentGeometry` contains only
current certified solved outputs (including spline cubic spans and driven
terminal points); it is null for checking/broken offsets. The ordinary
`sketch.entities`/`points` remain authored records, not solved offset geometry.
Last-good display curves are never exposed as usable profiles; independent
healthy source regions can still remain consumable when a descendant fails.

Source changes propagate through the production solver. Existing supported
requirements on offset outputs can size the originals and can be edited with
`sketch.dimension.update`; they do not change the relationship's authored
separation. `sketch.offset.update` takes current basis/draft, the discovered
`derivationId`, `value` (a signed distance number or authored expression such as
`"2*depth"`), and `intent`. It shares the browser's **Edit distance** / Save
owner: one undoable edit, stable output identities, expression/variable binding
retained across save/reopen. Unresolved or degenerate distances keep the
relationship with structured diagnostics and withhold its failed outputs from
profiles; independent healthy source regions may remain usable under the
existing publication rules. `sketch.offset.remove` takes the current
basis/draft, discovered `derivationId` and `intent`. Recipes can select that
relationship by `derivationId: { "alias": "offset", "label": "Offset 2" }`, using
its exact unique discovered label (never a guessed ID or first match). It uses the browser's
**Remove Offset** owner, removes its outputs/requirements as one action, and
leaves dependent relationships explicitly broken. Private undo/redo restores
relationship/output identities. Publication/reopening retains the relationship.

## Reciprocal sketch mirrors

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

## Durable sketch patterns and transforms

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

## Sketch supports and external references

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
completion with the browser, creating one **Reference** private action.
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

## Sketch styles and raster reference images

All style/image commands take current `basis`/`draft` and explicit `intent`.
`sketch.style.patch` takes nonempty owned `targets` and one `{ field, value }`
patch. Fill targets are current enclosed regions; stroke targets are local
entities. Fields follow the existing style owner: `fillMode` (none/solid/gradient),
`fillColor`, `fillOpacity`, `gradientStartColor`, `gradientEndColor`, `strokeEnabled`,
`strokeColor`, `strokeWidth`, `strokeCap` (butt/round/square), `strokeJoin`
(miter/round/bevel), `strokeMiterLimit`, `strokeDashSize`, `strokeGapSize`.
`fillOpacity` is a finite solid-fill alpha in [0, 1]: 0 is transparent, 1 is
opaque, and omission retains the native 0.42 default. Later color edits preserve
authored alpha. Gradient stop opacities retain their existing defaults.
Numeric stroke values are finite and nonnegative; widths/dashes/gaps are the
existing SVG pixel values, not model dimensions. Color strings retain the
browser's policy (including CSS variables), not a new color parser. Styles
preserve geometry and current profiles. A changed patch is one **Fill** or **Stroke**
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

## Document variables and expressions

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

## Private sketch dimensions

`sketch.dimension.add` takes the current `basis` and `draft`, an `axis`
(`horizontal` or `vertical`), two discovered sketch-point targets (or raw point
IDs) in `points`,
and either `mode: "driving", value: <positive number>` or `mode: "reference"`.
`sketch.dimension.update` takes `dimensionId` (a discovered dimension target or
raw ID) and `value`; updating a reference
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

## Complete sketch requirements

`sketch.requirement.add` takes current `basis`, `draft`, explicit typed
`targets`, a `tool`, `mode`, `value`, and `intent`. It uses the browser's
constraint registry, contribution preparation and solver, not tool gestures.

| Tool | Supported operand combinations |
| --- | --- |
| `constraintCoincident` | Two local points; two local lines; local point/curve; local point or circle center with a supported datum/projected point or curve |
| `constraintCollinear` | Local point/line and local, datum or projected line |
| `constraintParallel`, `constraintPerpendicular` | Two local lines, or a local line and datum/projected line |
| `constraintTangent` | Local line/circle/arc with circle/arc; supported local curve with projected circle/arc |
| `constraintEqual` | Two local lines (equal length) or two local circles (equal radius); no mixed line/circle pairs or arcs |
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

For equal-radius circles, add `constraintEqual` relationships between pairs and
size one circle with `dimensionRadius` or `dimensionDistance` (diameter). The
shared solver resizes every connected equal circle and reports conflicting
driving sizes as invalid, not fulfilled. These relationships persist in native
files as `equalLength` constraints (the same contract used by equal-length lines).
Arc radius equality is deliberately unsupported.

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

## Sketch geometry edits

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
