---
name: cadara-cli-modelling
description: Model native CADara parts through the browserless `cadara document recipe` CLI. Use when authoring, editing, saving, reopening or exporting a `.cadara` model from the command line, or judging whether a recipe run succeeded.
---

# CADara CLI modelling

The CLI is a semantic CAD API. A recipe is one JSON file of typed operations that run in order against one private document, with no toolbar or pointer steps. Each run prints one JSON **envelope** on stdout. That envelope is the only evidence you have of what happened.

`<cli>` below means a built package directory containing `main.js`, `README.md`, `COVERAGE.md` and `examples/`. In a checkout, the same docs and examples are under `src/cli/`.

## Authorities

Read these instead of guessing an operation's shape:

- `<cli>/README.md`: fields, units, bounded variants and selector rules for each operation. Read the section for every operation before you use it.
- `<cli>/COVERAGE.md`: a list of the closed operation set. It does not promise that a given combination runs. Where it disagrees with a README section (for example, units), the README section wins.
- `bun <cli>/main.js document recipe --help`: concise help and the operation list.
- Discovery in each result (see Reference): references, `model.capabilities`, `exportProviders`.
- `<cli>/examples/multi-sketch-part.json`: the qualified example below.

**Discover inputs.** Use `bun <cli>/main.js document recipe --schema` for the contract-derived catalogue, or `--schema extrude.create` for one operation's shape, capability and field units; `--help` lists operations. Lengths are millimetres; check each angle field's unit. See [Discovering operations and units](../../../src/cli/README.md#discovering-operations-and-units).

**Read errors by exit code.** Exit `2` leaves stdout empty: parse the first stderr line as `{ version: 1, error }`; the human summary follows. Exit `1` keeps the stdout envelope: selection/initialization failures add `error`, while semantic failures remain in the last result's outcome and diagnostics. Ambiguity errors list typed `candidates` with `owner`; choose the intended owner with `sketch` or use its discovered `target`. See [Errors and exit codes](../../../src/cli/README.md#errors-and-exit-codes).

**Choose output detail.** Use `bun <cli>/main.js document recipe --output compact recipe.json` when receipts, outcomes, diagnostics, structured errors and the last discovery's labelled references/bounds suffice. Compact output is versioned; it omits intermediate discovery detail and replaces final body topology with omission counts. Keep the default `detailed` for topology or intermediate sketch evidence. Compact saves printed bytes, not native work. See [Compact output](../../../src/cli/README.md#compact-output).

## Workflow

1. **Get the built CLI.** Use the package path you were given. If you have a checkout and no package, build once with `bun scripts/build-cli.mjs /tmp/cadara-cli` (about 30–50 s; `bun run build:cli` writes `dist-cli/`). Then run `bun /tmp/cadara-cli/main.js document recipe recipe.json`, which starts in about 1–2 s and uses about 400 MiB. Rebuild only after CLI or model sources change. `bun run cli` / `bun src/cli/main.ts` is the development source entry. It costs about 30 s and 5–6 GB per process because Typia transforms at startup (investigation: cadara-0bl), so keep it for debugging that entry itself.
2. **Plan the model** using the Design intent guidance below, then choose operations from the README sections. Pick operations only from the closed set; a toolbar tool is not a recipe operation. The basic `point`, `line` and `rectangle` (`start`, `end`) primitives appear in COVERAGE and the examples; README covers round and advanced primitives. Sketch coordinates are plane-local, given by the `discovery.sketch.support.frame` returned by `sketch.begin` (`xAxis`, `yAxis`, `normal`). For the base planes, local (x, y) maps to world (x, y) on `xy` with normal +z, to (y, z) on `yz` with normal +x, and to (x, z) on `xz` with normal −y. A positive extrusion goes along the normal.
3. **Prefer one recipe** when available selectors suffice: author, edit, save, reopen and export can share a single run. When a later operation needs discovered typed references or geometry-based face/edge selection, save a completed stage, inspect its detailed discovery, then reopen that file in a continuation recipe using the discovered identities. Recheck target currentness after edits; never guess IDs. Give every operation a unique `commandId`, give every result you will reference an `as` alias, and chain `basis`/`draft` from the previous result (see Reference).
4. **Run it** with stdout and stderr in separate files, and record the exit code: `bun <cli>/main.js document recipe r.json >out.json 2>err.txt; echo $?`. Recipe paths resolve against your working directory.
5. **Judge the run** against the success criteria. It succeeded only when all of them hold.
6. **Report** each command's outcome and receipts, the chosen design variables and assumptions, and any remaining sketch freedom or parametric limitations. For a command failure, name the failing `commandId`, its outcome and completion facets, and the diagnostics. For a cleanup-only failure, report cleanup failures and diagnostics rather than blaming a completed command.

## Design intent

Build an editable parametric model, not just the requested silhouette. Before authoring, identify the independent design choices, the relationships between them, and the sketches/features that express them.

- **Centralize variables.** Create document variables before opening sketches for user-facing dimensions, repeated sizes and reasonable assumptions where the request leaves dimensions open. Use one variable per independent design choice, shared across sketches and features; derive dependent values with expressions rather than separate knobs or copied numbers. For an enclosure, this could be `width`, `depth`, `height`, `screwDiameter` and `ventWidth`, with wall thickness or clearances separate only when independently meaningful. State assumed values and what each size means; clarify ambiguity that changes fit, function or the intended design instead of hiding it behind a default.
- **Wire the parameters.** Variables must drive actual dimensions/features, not merely document numbers baked into coordinates. Use `variable.add` and the README's supported expression fields. Dimension creation takes numeric values: create the dimension, then use `sketch.dimension.update` with an expression referencing the shared variable. Keep seed coordinates as initial geometry, not the source of design intent. Where a field cannot retain an expression or relationship, report that limitation rather than claiming it is parametric.
- **Group cohesive geometry.** Put related coplanar profiles in one sketch when they share design intent and should change together: a mounting-hole layout, a vent array, or concentric outlines. Prefer supported patterns, symmetry and shared dimensions over independently authored copies. Split sketches for different supports, independent design responsibilities or downstream dependency needs—not automatically for each primitive. Select the intended regions from discovery; multiple profiles need not share one `Outer region`. Keep unrelated geometry out of a giant catch-all sketch.
- **Name sketches by purpose.** Use `sketch.label.set` on the discovered sketch target while its draft is open, before publication. Choose names such as `Enclosure footprint`, `Mounting-hole layout` or `Side vents`, rather than `Sketch Draft` or numbered primitive names. Recipe aliases do not rename document sketches. Name bodies for the parts they represent, and give important driving dimensions meaningful labels where supported.
- **Constrain relationships, not snapshots.** Aim for fully constrained sketches using driving dimensions and supported geometric constraints: coincidence to the origin/datums, horizontal/vertical, parallel/perpendicular, concentricity, tangency and symmetry as appropriate. Anchor position and orientation as well as size. Reuse constraints supplied by primitives instead of adding redundant ones. Do not use `constraintFix` to freeze geometry into place; preserve the intended ways the model changes through its parameters. Check the README's operand restrictions rather than assuming every constraint supports every curve.
- **Verify editability.** Before publishing, inspect `discovery.sketch.solveStatus`: usable geometry alone does not prove constrainedness. Claim a fully constrained sketch only with `constraintState: "wellConstrained"` and a successful solve. Resolve unintended freedom where supported; otherwise report the remaining freedom or unknown status, without forcing a green status with Fix or conflicting dimensions. For shared parameters, trial a representative variable change in a disposable saved copy and inspect the intended dependent geometry and receipts; deliver the requested values, not the trial values.

## Success criteria

A run fulfilled the request only when **all** of these hold:

- the exit code is `0`
- `unexecuted` is `[]`
- every `results[i].outcome.kind` is `"completed"`
- `cleanup.kind` is `"closed"` and `cleanup.resourcesReleased` is `true`
- the geometry and receipts you intended are present: body count, `bounds`, face `topology`, feature `producedTargets`, labels, `completion.file.kind == "written"` for every save and export.

Recognise these failures. None of them is success, and none can be reported as partial success of the request:

| Signal | Meaning |
| --- | --- |
| exit 2, empty stdout | Rejected before runtime start: parse the first stderr line's JSON `error` for the command, path and expected shape or suggestions. Nothing ran. |
| exit 1, stderr `Recipe failed; prior completed operations are retained.` | Inspect the last result's outcome and `diagnostics`, and `cleanup`. If all commands completed, teardown alone may have failed: read `cleanup.kind`, `cleanup.failures` and `cleanup.diagnostics`. `unexecuted` lists commands that never ran. |
| exit 1, stdout `error.code` is `selection-unresolved` or `selection-ambiguous` | A selector matched zero or several references. Read `error.path`, `selector` and `candidates` with owners (`available`/`availableCount` when nothing matched). The failing command is `unexecuted[0]`; it and everything after it never ran, so it has no result. The completed prefix is not the job. |
| `failed` with `failures: ["geometry"]`, `live: applied`, `geometry: invalid-editable` | Invalid solve or geometry under `intent: "fulfill"`. The live state **did** change. |
| `accepted-invalid` | Only possible under `intent: "author-invalid"`: editable invalid state, no usable profiles or output. The exit code can still be `0` if nothing later requires valid geometry. Later `requireProfiles` publication is `rejected: profiles-unusable`. An invalid solve is a failure to produce valid geometry, even when `author-invalid` permitted it: report it as invalid, never as a fulfilled model. |
| `rejected` (`reasonCode`) | Refused. Nothing was applied. |
| `conflicted` | Stale `basis` or `draft`. |
| `unavailable` (`capability`) | That capability is unavailable in this context. |
| `failed` with `["file"]` on save or export | Not saved or exported. `persistence: committed` can still appear: a repository commit is not a disk write. `file.bytesWritten` reports any partial bytes. Saving and exporting do not create parent directories. |
| exit 1, `initialization` envelope with `results: []`, `error.code: "initialization"` | The modelling runtime did not start; read `initialization.diagnostics` and cleanup. |

Execution stops at the first failure. Earlier changes are not rolled back, and saving is not atomic.

## Reference

**Ownership.** Each invocation owns one private document. Processes share nothing except the files you save or open. `document.open` gives a fresh editing context with empty undo history. A sketch is a private draft until `sketch.publish` (or `sketch.discard`). Feature, variable, save and export operations run in document context, so publish first. `requireProfiles: true` makes publication prove that a consumable profile exists.

**Basis and generation.** `document.create` and `document.open` take `basis: null`; every later operation takes `basis`: `{ "alias": "<as of the latest result>" }`. Draft operations also take `draft`, the latest draft alias, because each private edit advances the draft generation even when the document revision does not change. An older alias gives `conflicted` and is never rebased automatically.

**References.** `{ "alias": "a", "label": "L" }` selects the one reference labelled exactly `L` in alias `a`'s discovery that is eligible for that operation's field. An alias is an immutable **snapshot** of one result's discovery. It is not a variable bound to an object. Labels are generated per sketch or feature: `Outer region`, `Rectangle 1 left`, `Extrude 1`. Every sketch is labelled `Sketch Draft` (select one with the `sketch` qualifier, or give it a name with `sketch.label.set`), and body labels start equal to their feature's label. Read labels from discovery `references[]` entries, which have the shape `{ label, target: { kind, …ids } }`. Typed references (`{ "kind": "region", "sketchId", "regionId" }`) are valid only with IDs copied from discovery.

**Qualified profile selection.** Every sketch has its own `Outer region`, so once a second sketch exists an unqualified profile label is ambiguous. Add `"sketch": "<owner alias>"`, for example `{ "alias": "wall", "label": "Outer region", "sketch": "wall" }`. After publication, use the **publish** alias as the owner, because the draft alias's private identity does not match published references. Any `{alias, label}` field accepts this qualifier (README, "Sketch-owner-qualified target selectors").

**Units.** Units depend on the operation. Lengths are document millimetres. Angles vary: extrude draft, revolve angles, circular sketch patterns and expressions use radians, while constraint angle creation and numeric dimension updates, chamfer angles, hole countersinks and body transforms use degrees. Check the operation's README section every time.

**Bounded capabilities.** A registered tool or successful authoring does not mean an operation is supported downstream. For example, an ellipse can be authored but has no consumable profile. Use only the README's bounded variants, `model.capabilities` and `exportProviders`. Treat a refusal as the answer: report it rather than looking for a route around it.

**Receipts.** Each result's `completion` has separate facets: `live` (applied or unchanged in this process), `geometry` (current, invalid-editable or failed native rebuild), `persistence` (repository commit, which is not a disk write), `file` (written or failed, with `bytesWritten`) and `handoff`. `cleanup` reports process teardown. `discovery` is `null` after a failed handoff. A model is saved only when its `document.save` result is `completed` with `file.kind: "written"`. An export is a separate file write and does not save editable history.

**Where the evidence is.** In `results[i]`:

- `diagnostics` holds semantic failure causes. Selection/initialization failures instead have an envelope-level `error`; stderr carries a human summary.
- `discovery.model.bodies[]` has `bodyId`, `bounds` and `topology`. Topology entries have `entityClass` (body, face, edge, vertex), `geometryType`, `boundingBox` and `centroid`.
- Body, sketch and feature labels are in `discovery.references[]`, not on the body records.
- `discovery.model.features[]` has `featureId`, `label` and `producedTargets`, which shows the bodies each feature produced.

When predicting topology, remember that a face partly overlapped by a joined feature stays split into pieces. The example's wall sits flush on the plate's end, so it keeps the minimal 8 faces; a wall standing inside the plate area does not. A plane face's `definingData.normal` is not its outward orientation.

## Example

`<cli>/examples/multi-sketch-part.json` is qualified by `src/cli/modelling-skill-recipes.spec.ts` against the built package. In one run it:

1. extrudes the xy sketch's `Outer region` (40×20, depth 4) into a plate
2. publishes a yz sketch (20×30) and extrudes its owner-qualified `Outer region` by 4, using the `parameters` form (README, "Extrusion variants and rebuild") with `operation: join` and `booleanScope: { "kind": "targetBody", "bodyId": { "alias": "wall", "label": "Extrude 1" } }`
3. edits the wall with `extrude.update` (`featureId` `Extrude 2`, depth 6) and renames the body to `L bracket`
4. saves `l-bracket.cadara`, reopens it, and exports `l-bracket.step` and `l-bracket.stl` from the reopened body.

Expected evidence: one body with bounds `[0,0,0]`–`[40,20,30]` and 8 planar faces. After the edit, the wall's inner face sits at x = 6 and spans z 4–30; bounds alone cannot show this edit. The reopened discovery shows the same faces, a body labelled `L bracket` and `history.canUndo: false`. The save and both exports are `file.kind: "written"`.

## Debugging within bounds

- **Reuse artefacts.** Query the envelope you already have instead of rerunning: `jq -c '.unexecuted, .cleanup, (.results[] | [.correlation.commandId, .outcome, .completion.file.kind])' out.json`. Detailed output carries full discovery per result, often 20–40 KB; keep it in files and extract only what you need, or choose compact output when its retained evidence suffices.
- **Inspect saved models cheaply.** To look at a saved model, run a two-operation recipe (`document.open` then `document.inspect`) on its file. Do not rebuild the model from scratch for that.
- **Shorten the loop.** Iterate on the failing command with the shortest prefix that reaches it. Optionally, continue from an already-saved good `.cadara` file.
- **Fix from evidence.** Use diagnostics and discovery labels to correct the input, and change one thing at a time. A refusal of an unsupported variant is final; check the README instead of retrying variations.
- **Check written files cheaply.** A binary STL holds `(bytes − 84) / 50` triangles. STEP files carry B-rep geometry but not CADara body labels.
- **Ignore STEP stderr noise.** Exporting STEP prints Open CASCADE transfer statistics on stderr. Judge the run by the exit code and the envelope.

## Workarounds that hide defects

Keep the model honest. Each of these masks a failure the user needs to see:

- When a label is ambiguous, qualify it with `sketch`, or use a discovered typed reference. Do not add helper geometry to make labels unique, take the first or last match, or guess generated IDs.
- When a save or other receipt fails after an accepted edit, report it with its diagnostics as a defect. Do not settle it with a dummy document rename, patch native JSON, or weaken or bypass certification.
- Stage save/reopen only for handoff, persistence checks or discovery-dependent continuation (see Workflow). Label ambiguity alone is resolved with qualified selectors, not extra subprocesses.

## Visual evidence

Opening a saved `.cadara` in the CADara web editor and taking a screenshot gives optional, separate visual evidence. The viewport can show last-good display geometry, so a screenshot does not prove exact native correctness. The CLI has no browser, renderer or PNG export dependency. Exact proof is the envelope's bounds, topology and receipts plus the written files.
