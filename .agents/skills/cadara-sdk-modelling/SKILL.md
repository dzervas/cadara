---
name: cadara-sdk-modelling
description: Model native CADara parts through SDK scripts. Use to author, edit, probe, save or export a .cadara model, or trace a script as a replayable recipe.
---

# CADara SDK modelling

Use this workflow to build an editable parametric part. Scripts select from live discovery and automatically chain basis/draft authority; a handle is not a transaction or rollback point.

## Workflow

1. **Obtain the package.** Use the supplied built package, or build once in a checkout: `bun scripts/build-cli.mjs /tmp/cadara-cli`. `<cli>` below is that complete directory, including shared JS chunks, `occ/`, docs and types. Run the bundle for modelling; source startup pays the Typia transformation cost. Read `<cli>/SDK.md` for the script/API contract and `<cli>/README.md` for each operation's fields and units. Source equivalents live in `src/cli/`; `document recipe --schema <operation>` provides the generated input contract.
2. **Plan design intent.** Apply [Design intent](#design-intent) before coding. Finish with independent variables, derived relationships, purposeful sketch/feature responsibilities, assumptions and a representative edit whose dependent geometry you can check.
3. **Write one script.** Default-export `async (doc) => value`; the runner supplies an already-created document. Use `doc.ops.document.open({path})` to edit a saved part. Await `doc.ops.<operation>(fields)` or `doc.op("operation", fields)` sequentially through `doc`, which chains actual live authority and defaults geometry intent to `fulfill`. Import types from `cadara-cli/sdk` using the installed package for consumer typechecking; Bun itself only transpiles TS. `<cli>/examples/sdk-plate.js` is a qualified starting point, not a fully constrained design: its XY sketch remains underconstrained. Finish authoring with the intended relationships, labels and consumable profiles in discovery.
4. **Select from live evidence.** Use `doc.references({owner,kind})` for owner-scoped typed targets, `doc.topology("face"|"edge")` for native geometry joined to selectable references, and `doc.inspect(["bounds","topologyCounts",...])` for compact facts. Read `doc.current.discovery` for exact targets and solver status. Resolve every ambiguous label by intended owner or an exact discovered target; rediscover topology after edits. Use the support frame for face-backed coordinates (see [Coordinates and units](#coordinates-and-units)). Proceed only when the selected references match the intended geometry.
5. **Probe editability.** For example, `await doc.probe([{operation:"variable.update",fields:{variableId:{label:"width"},name:"width",valueText:"80"}}])` reconstructs an isolated copy and omits writes. Check every edit outcome, current-geometry receipt, expected dependent bounds/topology/positions and copy cleanup against the plan. A successful variable update alone is insufficient. Keep original input files/images unchanged; for dimension probes, leave/open the relevant draft first. See `<cli>/SDK.md`, **Disposable parametric verification**, for reconstruction and selector limits. The source must retain its requested values and unchanged authority/trace after the probe.
6. **Save/export explicitly.** Publish private drafts before document-context features, variable edits, saves or exports. Create output parent directories first. Save native editable history and perform each requested export separately; the runner has no automatic save. Check each returned handle's `.result.completion.file` against [Outcomes and receipts](#outcomes-and-receipts). Return concise JSON-compatible evidence; send script logs to stderr so stdout remains parseable.
7. **Run with retained evidence.** `bun <cli>/main.js script model.ts --trace model.recipe.json >out.json 2>err.txt; echo $?`. Scripts are trusted Bun code with process permissions; run inside the normal external sandbox. Keep the script, inputs, exit code, stdout/stderr and trace beside delivered files. If trace export or replay is requested, read `<cli>/SDK.md`, **Trace and replay**, then use the [recipe reference](../cadara-cli/SKILL.md#workflow) to replay. Review output paths first: replay can overwrite files. A trace records document history, not script control flow; report any portability refusal rather than substituting raw command IDs.
8. **Judge and report.** Apply every criterion in [Outcomes and receipts](#outcomes-and-receipts), including caught failures. Report native/export paths with written receipts, independent variables and assumptions, remaining sketch freedom, exact probe edits and dependent facts, every semantic/selection/cleanup failure, and whether the requested trace exported/replayed. A nominal silhouette or exit 0 alone does not establish fulfillment.

**Trace portability.** New traces always use envelope v2; current readers also replay unchanged v1, while old v1-only binaries explicitly refuse v2. Before editing a trace or diagnosing export refusal, read `<cli>/SDK.md`, **Trace and replay**: creation references bind supported authored outputs by producer, sketch owner and semantic slot, independently of labels/discovery ordering. Spline tangents bind ordered fit-point occurrences and rebind in reopened drafts. Preserve those bindings when reviewing recipes; report `SemanticTraceError` command/path/reason for pre-existing ambiguous asset refs or unsupported outputs. Probes retain bindings across omitted writes. Semantic commands/native files retain their versions and identities.

## Design intent

Build an editable parametric model, not just the requested silhouette.

- **Centralize variables.** Use one document variable per independent design choice, shared across sketches/features; derive dependent values with expressions instead of copied numbers or extra knobs. Create variables before opening sketches. State assumed values and what each size means; clarify ambiguity that changes fit, function or design intent.
- **Wire parameters.** Variables must drive dimensions/features. Use `variable.add` and the supported expression fields in SKETCH-OPERATIONS.md (Document variables and expressions). Dimension creation takes numeric values: create the dimension, then `sketch.dimension.update` with an expression referencing the variable. Coordinates seed geometry; dimensions and relationships carry intent. Report fields that cannot retain the intended expression or relationship as parametric limitations.
- **Group cohesive geometry.** Keep related coplanar profiles together: hole layouts, vent arrays and concentric outlines. Prefer supported patterns, symmetry and shared dimensions over independent copies. Split sketches by support, design responsibility or downstream dependency, rather than per primitive. Select intended regions from discovery; several profiles need not share one `Outer region`.
- **Name by purpose.** Use `sketch.label.set` on the discovered sketch target while its draft is open, before publication: `Mounting-hole layout`, not `Sketch Draft`. Name bodies for their parts and driving dimensions for their purpose. Script variables and recipe aliases do not rename document objects.
- **Constrain relationships.** Anchor position/orientation to the origin or datums as well as driving size. Use coincidence, horizontal/vertical, parallel/perpendicular, concentricity, tangency and symmetry where appropriate, respecting README operand restrictions and primitive-supplied constraints. Preserve intended parameter motion with relationships rather than freezing snapshots with `constraintFix`.
- **Verify editability.** Inspect `discovery.sketch.solveStatus` before publishing. Claim full constrainedness only with a successful solve and `constraintState: "wellConstrained"`, backed by intentional relationships. Resolve unintended freedom where supported and report remaining freedom or unknown status honestly. Probe a representative shared-variable or driving-dimension edit and inspect actual dependent geometry; deliver the requested values, not trial values.

## Outcomes and receipts

An operation returning a handle is not itself proof of fulfillment:

| Signal                      | SDK behavior and interpretation                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completed`                 | Returns a handle; check its geometry and other required receipts.                                                                                                                |
| `canceled`                  | Returns a handle; does not certify application.                                                                                                                                  |
| `accepted-invalid`          | Returns only for explicit `intent: "author-invalid"`; editable invalid state is not usable-geometry success. Later publication with `requireProfiles` rejects unusable profiles. |
| `rejected`                  | Throws `SemanticOperationError.result`; refused without applying.                                                                                                                |
| `conflicted`                | Throws with actual state; stale basis/draft authority.                                                                                                                           |
| `unavailable`               | Throws with the unavailable capability.                                                                                                                                          |
| `failed`                    | Throws with diagnostics and all completion facets. Geometry failure can have `live: applied` and `geometry: invalid-editable`: state changed despite failure.                    |
| selection missing/ambiguous | Throws `SelectionError.selection` with candidates/owners or available references; no semantic command executed.                                                                  |
| failed save/export          | Throws; `persistence: committed` is not a disk write. `file.bytesWritten` can report partial bytes; saving is not atomic.                                                        |

`tryOp` returns `{ok:true,handle}` or `{ok:false,error}` for semantic/selection failures only; programming errors still throw. `<cli>/SDK.md` defines the API error types and initialization/cancellation contract.

**Receipts.** `completion` separates `live` (applied/unchanged), `geometry` (current/invalid-editable/failed rebuild), `persistence` (repository commitment), `file` (written/failed with path and bytes) and `handoff`. Failed handoff leaves `discovery: null`, not earlier evidence to reuse. Native save succeeds only with a completed `document.save` and `file.kind: "written"` for the intended path/bytes. Exports are separate writes and do not save editable history.

**Fulfillment requires all of:** exit 0; every intended operation completed; expected body count, native bounds/topology, labels and feature `producedTargets`; written receipts for every requested file; and `cleanup.kind: "closed"` with `resourcesReleased: true` for the source and probes. Verify parametric behavior and constrainedness as specified in Design intent. Caught failures can coexist with exit 0: inspect every runner `results` entry and `cleanup`, and report failures rather than claiming fulfillment. Completed prefixes remain evidence of changes, not fulfillment of the request. Direct `openCadara` callers own `await doc.close()` in `finally` and must inspect cleanup too. For recipe-specific envelopes, exits and `unexecuted`, use the [CLI failure signals](../cadara-cli/SKILL.md#failure-signals).

## Coordinates and units

Lengths are millimetres in the shipped headless composition. Angle fields vary between radians and degrees by operation, including creation versus expression updates: check `<cli>/README.md`, **Discovering operations and units**, and the relevant operation section rather than assuming one angle unit.

Sketch coordinates are plane-local. Base-plane local `(u,v)` maps to world `(u,v,0)` for `xy` (normal +z), `(0,u,v)` for `yz` (normal +x), and `(u,0,v)` for `xz` (normal −y). Positive extrusion follows the normal. Face-backed supports can be translated/rotated: use the discovered `support.frame`, `doc.worldToLocal` and `doc.localToWorld`; world-to-local projects away off-plane distance.

## Workarounds that hide defects

- **Resolve identity from evidence.** Narrow ambiguous labels by owner or exact discovered target. Helper geometry, first/last matches and guessed IDs mask selection defects.
- **Preserve failed receipts.** Report a failed save or certification after an accepted edit with its diagnostics. Dummy renames, native JSON patches and bypassed certification hide defects rather than repair them.
- **Use handoffs purposefully.** Save/reopen for delivery or persistence verification; use live owner-scoped discovery for selection. Label ambiguity does not require extra processes.
- **Respect bounded capabilities.** Consult README variants, `model.capabilities` and `exportProviders`. Successful authoring does not guarantee a consumable profile or downstream support. Report an unsupported refusal as the answer rather than searching for a route around certification.

## Debugging within bounds

Reuse retained stdout, typed errors and `doc.inspect` facts before rerunning native work. Isolate the failing call with the shortest reproducible prefix, or open a known-good saved file to debug a continuation. Change one input at a time using diagnostics and live discovery. `<cli>/SDK.md` is the authority for caught-error probe/trace eligibility; retain terminal failures even when a trace omits not-applied calls.

Check topology, not bounds alone, for edits that move internal faces. A partially overlapped joined face can remain split; a plane's `definingData.normal` is not its outward orientation. Binary STL triangle count is `(bytes − 84) / 50`; STEP carries B-rep geometry, not CADara body labels. Open CASCADE STEP transfer statistics on stderr are noise: judge receipts and outcomes. Optional editor screenshots are separate visual evidence and may show last-good geometry; native facts and written files certify exact results.

## Qualified example

`<cli>/examples/sdk-plate.js` is exercised by `src/cli/sdk-scripts.spec.ts`: thickness drives extrusion, a disposable edit changes depth from 4 to 6, and the source saves at 4. The spec also qualifies the installed package's typed errors, save/STEP export, direct reopen, catch-and-continue trace replay, duplicate-label/tangent v2 replay and independent consumer typechecking. `evaluations/agent-modelling/verify-sdk-references.sh` checks five saved reference parts through the shipped script/SDK seam.
