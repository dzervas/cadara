# cadara CLI

For TypeScript modelling, see [SDK.md](SDK.md): `cadara script <script.ts> [--trace <recipe.json>]` runs the shipped `cadara-cli/sdk` over the same session and resolver. Scripts are trusted Bun code, not sandboxed.

`cadara` is the general-purpose command-line tool for the CADara project. It
runs under Bun (never in the browser; Node runs the repository test harness) and shares contract and domain code
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

### Self-contained release

Build with `bun run build:cli` (not the Vite web build). This writes `dist-cli/`;
`bun scripts/build-cli.mjs /absolute/output/directory` selects another output.
Distribute that directory or archive its contents. Use a fresh output directory
for a release. No install, source checkout, Bun preload or node_modules is needed
on the receiving machine, only Bun 1.3.13+ and the complete package:

```bash
tar -czf cadara-cli.tar.gz -C dist-cli .
# On the receiving machine, extract into a new directory:
mkdir cadara-cli && tar -xzf cadara-cli.tar.gz -C cadara-cli
bun /absolute/path/to/cadara-cli/main.js document recipe --help
bun /absolute/path/to/cadara-cli/main.js document recipe /absolute/path/to/cadara-cli/examples/plate.json
```

Runtime files include `main.js`, `sdk.js`, shared `chunk-*.js` modules and
`occ/cadara-occ.js` / `occ/cadara-occ.wasm`. Keep them together. Assets resolve
relative to the built modules, not your working directory. TypeScript consumers
also need the package declarations and its declared Typia type dependency. Typia is transformed at build time. Both native files are copied
unchanged from the production custom build; there is no native build or fallback.
The reachable memory repository has no Automerge WASM runtime dependency.
Metadata, license, this guide, [coverage matrix](./COVERAGE.md) and runnable
`examples/` are included. Input/output recipe paths remain relative to the
caller's working directory. The extracted-package test runs outside the checkout
with no package-local source/node_modules and replays the same foundation test.

## `document recipe`

Run sequential native document operations against an isolated editing context:

```bash
bun run cli -- document recipe recipe.json
bun run cli -- document recipe --output compact recipe.json
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
results, unexecuted command IDs and awaited cleanup (see
[Errors and exit codes](#errors-and-exit-codes)); stderr carries a human summary
under the shell's 0/1/2 policy. Execution stops at the first failed operation;
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

### Typed targets and owner-scoped discovery

Semantic target fields accept the corresponding typed `target` copied from
`discovery.references`, including fields named `bodyId`, `featureId`,
`beforeFeatureId`, `sketchId`, `dimensionId`, dimension `points`, nested
`booleanScope.bodyId` / `bodyIds`, and replay `sourceFeatureIds`. Existing raw
IDs and recipe label selectors remain supported. Typed point and dimension
selectors must belong to the current draft's sketch; an ID from another owner
is not silently reinterpreted as a local target. Canonical references themselves
still contain raw IDs, and basis/draft certificates are unchanged.

Every `discovery.references[]` entry is `{ label, target, owner }`. Sketch
geometry belongs to its sketch; body topology belongs to its body; produced
bodies and construction planes belong to their producing feature. Sketch and
feature roots own themselves. Document construction planes have `owner: null`.
`discovery.sketch.sketchId` identifies a draft immediately, before publication.

`document.inspect` accepts an optional `owner`: a typed `sketch`, `feature` or
`body`, or the same `{alias,label,sketch?}` selector used for other target fields. It returns references with that exact owner plus the owner's own target
(so a body includes itself). It filters **only** `discovery.references`, not
`model`, draft details, history or other metadata. Omit it for document-wide
references. For example, after copying a sketch target from discovery:

```json
{ "version": 1, "commandId": "inspect-sketch", "operation": "document.inspect", "basis": { "alias": "latest" }, "owner": { "kind": "sketch", "sketchId": "<discovered sketchId>" } }
```

New point primitives generate distinct `Point N` (point) and `Point entity N`
(entity) labels. Authored duplicate labels are still allowed and ambiguous
selection still refuses; existing saved labels are not rewritten.

Extrude/revolve `booleanScope.targetBodies.bodyIds`, extrude `startExtent.target`, and reference-bound `extent.end` / `firstEnd` / `secondEnd` targets accept the same labelled selectors as other target fields. Each reference is resolved using its bounded kind (body, face, vertex, sketch point or start edge); native extent semantics are unchanged.

### Recipe versions and creation-output references

Readers accept envelope versions **1 and 2**. The SDK always emits **v2**, including traces that need only legacy selectors. Old v1-only binaries explicitly refuse v2; backward-read compatibility does not make new traces readable by old binaries. Per-operation semantic `version:1`, output envelopes and the native file format are unchanged; no minted IDs are persisted. `--schema` includes `recipeVersions`, the envelope shape and the generated `recipeTransport.creationReference` schema.

V2 target fields additionally accept a creation reference, for example:

```json
{"kind":"recipeRef","version":1,"createdBy":"point-created","owner":{"alias":"sketch-begun"},"output":{"kind":"sketchPoint","role":"authoredPoint","index":0}}
```

`createdBy` and `owner.alias` refer backward to executed producers and the owning sketch. Output roles are semantic authored slots, never discovery-list ordinals: `sketch.begin` → `sketch:0`; single-entity `sketch.author` → `authoredEntity:0` and semantic-entity-ordered `authoredPoint` slots; spline authoring → ordered `fitPoint` slots; `sketch.dimension.add` → `dimension:0`. A spline tangent uses `output:{kind:"sketchTangentHandle",role:"splineOccurrence",index:N}` on its spline producer. The occurrence slot distinguishes repeated fit-point IDs and rebinds to live handles after publication/reopening; changed/deleted geometry or expired slots refuse. These references survive relabeling, unrelated creation and reordered discovery.

Unique owner-qualified labels remain valid, including pre-existing assets and producer families without authored output slots (multi-entity rectangles/polygons, derived outputs, profiles and native topology). Ambiguous same-owner asset references without creation provenance cannot be exported portably; no asset fingerprint or raw-ID workaround is implied. Exact Typia validation rejects unknown versions/tags, extra keys, malformed slots and unknown/forward producers before modelling. Owner/kind/output availability errors stop before the affected command with structured selection diagnostics. See [SDK trace and replay](SDK.md#trace-and-replay) for limits, probe bindings and typed export errors.

### Sketch-owner-qualified target selectors

Generated labels are local to a sketch: two sketches each have an `Outer region`,
`Rectangle 1 left` and so on, so `{ "alias": "post", "label": "Outer region" }`
is ambiguous once both are in the named discovery. Any `{ alias, label }` target
selector may add `"sketch": "<earlier alias>"` to select only references owned
by that alias's sketch:

```json
{ "alias": "post", "label": "Outer region", "sketch": "base" }
```

The owner alias names the sketch its discovery identifies: a `sketch.publish`
result's published sketch, or the sketch a private-draft result (`sketch.begin`,
`sketch.open`, `sketch.author`, …) is editing. Use the publish alias after
publication: a new sketch receives its durable ID when published, so its draft
alias no longer matches published references. Selection is otherwise unchanged:
the exact label must match exactly one operation-eligible reference owned by that
sketch in the `alias` discovery. Missing, foreign or stale-draft owners, wrong
kinds and several matches inside the owner fail before the operation (completed
prefix and cleanup are reported, the rest is unexecuted); unknown or later owner
aliases and any other selector key are usage errors before runtime startup. The
owner only narrows label lookup: the resolved typed reference still goes through
basis, draft-generation and target currentness checks, and explicit typed
references (`{ "kind": "region", "sketchId", "regionId" }`) work as before.
Selectors without `sketch` keep their existing meaning. Non-reference lookups
(variable names, private dimension/derivation labels outside the owner's draft)
never match a qualified selector.

[`examples/scoped-profiles.json`](./examples/scoped-profiles.json) publishes an
xy and a yz single-rectangle sketch in one invocation, then extrudes each sketch's
`Outer region` by owner into two distinct boxes, without saving, reopening,
extra curves or generated IDs.
[`examples/multi-sketch-part.json`](./examples/multi-sketch-part.json) joins an
xy plate and a yz wall into one L-bracket body, changes the wall extrusion's
depth from 4 to 6 with `extrude.update`, renames the body, saves, reopens and
exports STEP/STL, writing into the working directory.

### Discovering operations and units

```bash
bun main.js document recipe --help                     # concise human help and operation list
bun main.js document recipe --schema                   # full machine-readable catalog
bun main.js document recipe --schema revolve.create    # one operation
```

`--schema` prints JSON generated at build time by Typia from the closed
`SemanticCommand` contract, the same types the recipe validator is generated
from, so it cannot drift from what is accepted. Each `operations[]` entry has:

- `schema`: the exact input shape (OpenAPI 3.1 JSON Schema; `$ref`s point into
  `components`; objects are closed, `oneOf` lists the bounded variants);
- `capability`: `featureKind`, `execution` and `preview`, taken from the
  production kernel capability matrix (`supportedFeatureKinds` /
  `previewableFeatureKinds`, also reported at runtime in
  `discovery.model.capabilities`). Non-feature operations report
  `preview: "not-applicable"`. For example, body mirrors/transforms and
  extrusion-operation replay execute but are not previewable;
- `units`: every field whose contract declares a unit (`x-unit`, `radian` or
  `degree`). Lengths and coordinates use the catalog's `lengthUnit`
  (`millimeter`). Angle units differ per operation and must not be guessed:
  revolve, draft, sweep-twist and sketch-pattern angles are radians; chamfer,
  hole countersink, body transform rotation and circular-pattern angles are
  degrees. A `value` whose unit depends on the dimension or derivation kind
  (`sketch.requirement.add`, `sketch.dimension.update`,
  `sketch.derivation.create`) has no `x-unit`; its schema `description` states
  its units (for example degrees for an angle dimension).

The catalog's `capabilityModel` separates four levels: a valid **shape** (refused
before the kernel starts when violated), **execution** capability, **preview**
capability, and **target-dependent refusal**: a valid command may still be
refused for the current targets/options at runtime. That command executes and
returns a `SemanticResult` with a `rejected`, `unavailable` or `failed` outcome
and diagnostics; it is not a CLI error. `recipe` documents the CLI-only
encoding (`as`, `{ alias }` basis/draft selectors and `{ alias, label }` target
selectors). `--help` and `--schema` never start the modelling kernel.

#`document.inspect.owner` accepts a discovered typed sketch/feature/body owner or the same `{alias,label,sketch?}` recipe selector as other target fields. Resolution is shared with the SDK; ambiguous owners report candidates rather than choosing an owner.

## Errors and exit codes

A run that starts the kernel prints exactly one JSON envelope on stdout,
`{ version: 1, results, ... }`, plus a human summary on stderr when it fails.
A refused invocation or recipe (exit 2) keeps stdout empty, like every usage
error; its first stderr line is the JSON `{ version: 1, error }` and the human
summary follows:

| Exit | JSON (channel) | Meaning |
| --- | --- | --- |
| 0 | `results`, `unexecuted: []`, `cleanup` (stdout) | Every operation completed (or was accepted-invalid) and cleanup closed. |
| 1 | `results`, `unexecuted`, `cleanup` (stdout) | A semantic result failed; it is the last entry of `results`. Unchanged contract. |
| 1 | `results`, `unexecuted`, `cleanup`, `error` (stdout) | A target/basis/draft selector could not resolve after an executed prefix. The affected command did **not** execute and has no `SemanticResult`; it is the first `unexecuted` ID. `error.code` is `selection-ambiguous` or `selection-unresolved`. |
| 1 | `initialization`, `results: []`, `error` (stdout) | The modelling kernel failed to start (`error.code: "initialization"`). |
| 2 | `error` (first stderr line; stdout empty) | Invalid invocation or recipe: nothing executed and the kernel never started. `error.code` is `usage`, `recipe-unreadable`, `invalid-recipe` or `unknown-operation`. |

Executed-recipe and initialization envelopes are unchanged apart from the
additive `error`. `error` fields:

- `code`, `phase` (`preflight`, `initialization` or `resolution`), `message`
  (also the stderr line), `help` (a `--schema`/`--help` command when useful);
- `commandIndex`, `commandId`, `operation`: the affected recipe operation, or
  `null` for recipe-level errors;
- `path`: Typia notation (`parameters.profiles[0]`) relative to that operation
  (relative to the recipe document when `commandIndex` is `null`);
- `issues` (`invalid-recipe` contract violations): each `path`, Typia
  `expected`, the offending `value`, the generated `schema` expected there
  (including its `x-unit`), or `allowed` property names for an unknown field;
- `suggestions` (`unknown-operation`), `knownAliases` and `selector` (alias
  errors), `expected` (generated schema of the selector's field);
- selection errors: `eligibleKinds`, `candidates` (every eligible reference
  carrying the label: `{ label, target, owner }`, where `target` is the
  canonical typed value and `owner` the owning `sketch` or `body` with its
  label), and when nothing matched `available` (up to 50 eligible values) and
  `availableCount`.

Correct an ambiguous selector by narrowing it to the intended candidate's
`owner`: add `"sketch"` naming the earlier alias whose discovery identifies that
sketch (the publish result whose `discovery.sketch.sketchId` equals
`owner.sketchId`). Alternatively use a candidate's `target` directly in the same
document (for example after `document.open` of a saved file, where identities
are stable).

### Compact output

`--output detailed` (the default, unchanged envelope) prints every result's
full canonical discovery. `--output compact` (before the recipe path) prints
the same envelope plus `"output": { "mode": "compact", "version": 1 }`, and
is validated against that versioned shape before printing. It is presentation
only: execution, alias resolution and validation always use full discovery, so
both modes select the same targets, stop at the same operation and exit with
the same code. Every result keeps its `correlation`, `outcome`, `completion`
receipts (live, handoff, geometry, persistence, file), `diagnostics` and
`changedTargets`; `unexecuted`, `cleanup` (including failures) and the additive structured
`error` (see [Errors and exit codes](#errors-and-exit-codes)) are kept verbatim.
Initialization failure keeps its `initialization` receipt with `results: []`.
Only discovery shrinks, always explicitly:

- Every result except the last one with discovery prints
  `{ "detail": "omitted", "state": ... }`, which keeps its exact basis and draft.
- The last discovery prints `"detail": "included"` with every labelled typed
  reference and all other discovery fields, but each body's exact topology
  signatures become `{ "detail": "omitted", "entries": N }`. `topology: null`
  still means unavailable (not empty), and `entries: 0` an empty list.
  Omission does not certify geometry; bounds are reported as computed.
- `discovery: null` (failed handoff) stays `null`.

Use detailed output to pick faces/edges by geometry, read private sketch
points from intermediate steps, or debug. Compact output only changes what is
printed: the runtime still computes full discovery, including exact topology,
so it does not make native work faster. Measured with the release bundle,
opening a public example and running ten `document.inspect` operations printed
1.09/3.30/5.75 MB detailed and 59/137/250 KB compact (bracket/wheel/enclosure),
with no consistent difference in wall time. `examples/compact-summary.ts`
consumes compact output: `bun examples/compact-summary.ts examples/plate.json`.

### Model cache

A released CLI (`bun dist-cli/main.js`, not `bun src/cli/main.ts`) keeps a
per-user cache of evaluated native checkpoints. When `document.open` reads a
native file whose exact content this build has evaluated before, the new
process adopts the stored native state (exact geometry, topology identities,
naming lineage, feature stages and identity counters) instead of replaying the
feature history; otherwise it rebuilds from the document and stores the
result. Every later operation, save, export and reopen behaves exactly as
without the cache. The file stays the source of truth: the cache is disposable,
never required, and never a repository commit or file write. Each process still
builds its own repository history, receipts and basis; bases from another
process are refused as before.

- **Location:** `$XDG_CACHE_HOME/cadara/model-checkpoints` when
  `XDG_CACHE_HOME` is absolute, otherwise `~/.cache/cadara/model-checkpoints`.
  Directories are created `0700`; a symlinked, foreign-owned or group/other
  writable cache directory and symlinked entry files are refused (the open
  proceeds uncached). A platform without user ids (Windows) bypasses the cache.
  The trace reason is `no-user-ownership-checks`.
- **Compatibility:** an entry is keyed by a SHA-256 of the complete document
  content as evaluated (the per-session document id excepted), every geometry
  asset's bytes, the evaluation settings and restore diagnostics, the checkpoint
  format, and a fingerprint of this build: every bundled JS file, the actual
  `occ/cadara-occ.js`/`.wasm` bytes (plus `OCC_ASSET_VERSION`), the Bun/runtime
  versions, platform and architecture. A different path, label, revision id or
  modification time does not matter; any content or build change misses.
  Documents with baked-body assets and failed or partially evaluated builds are
  never cached.
- **Entries:** one file per key holding a JSON manifest line (format, key,
  compatibility, member lengths, body SHA-256; validated exactly) followed by
  non-executable data. Writers publish through a synced temporary file and an
  atomic rename, so readers see a complete entry or none. Each entry is
  bounded to 256 MiB; above 1 GiB in total, least recently used entries are
  evicted; temporary files of interrupted writers are removed after an hour.
  Checksums detect corruption, not tampering. Before adoption, a decoded entry
  must re-export both the opened document's authored inputs and its own
  recorded document. Otherwise it is discarded and the document is rebuilt.
- **Controls:** `CADARA_MODEL_CACHE=off` bypasses the cache (default `on`).
  `cadara cache clear` deletes every entry. `CADARA_MODEL_CACHE_TRACE=1` prints
  each `hit`, `miss`, `published`, `bypass` (with reason) and `evicted` event as
  one stderr line `{"version":1,"modelCache":{...}}`. A `degraded` event (corrupt or
  incompatible entry, unsafe directory, permission, read-only or full storage,
  failed write) is always printed the same way; the open then proceeds from the
  document and the command result is unaffected. Any other failure is not a
  cache failure and propagates normally.
- **Privacy:** the cache retains model-derived data (exact geometry, labels,
  history) under your user until evicted or cleared.

### Operation reference

Fields, units, variants and selector rules per operation family live beside this file:

- [SKETCH-OPERATIONS.md](SKETCH-OPERATIONS.md): sketch primitives, curves, intersections, corners and slots, offsets, mirrors, patterns, supports and references, styles and reference images, variables, dimensions, requirements and geometry edits.
- [PART-OPERATIONS.md](PART-OPERATIONS.md): feature lifecycle and rollback, extrusion, revolve, construction planes, edge treatments, shell and thicken, holes, sweeps, lofts, booleans and splits, body mirrors/transforms/patterns, replay, undo/redo and export.

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
