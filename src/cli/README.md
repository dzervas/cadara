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

### Sketch geometry edits

After `sketch.open`, geometry edits take the current `basis`, `draft`, and
`intent: "fulfill"` or explicit `"author-invalid"`:

- `sketch.geometry.update` takes an `edit`: `point` with a point `target` and
  `position`, `translate` with an entity `target` and `delta`, `radius` with a
  circle/arc entity `target` and positive `radius`, or `tangent` with a typed
  `sketchTangentHandle` target and `vector`.
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
