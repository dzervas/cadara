# CADara TypeScript SDK (v1)

The SDK is the typed modelling seam over the semantic session. CLI recipes, SDK scripts and future hosts share the same resolver, validation, modelling owners and completion receipts. It is shipped in the `cadara-cli` Bun package as **`cadara-cli/sdk`**; importing it does not start a session or run the CLI. No browser, persistent runtime, renderer or sandbox is included.

## Run a script

Install the CLI package, then:

```sh
cadara script model.ts --trace model.recipe.json
cadara document recipe model.recipe.json
```

For an unpacked build, use `bun <package>/main.js script model.ts`. In a checkout, build once with `bun scripts/build-cli.mjs /tmp/cadara-cli`; source CLI startup is much more expensive. The package includes `sdk.js`, package-relative TypeScript declarations under `types/`, production `occ/` assets and these docs. Typia is the declared dependency for contract type annotations; runtime validators are already compiled into the bundle. Retain the whole package, including its shared JS chunks and assets.

A script default-exports a function receiving one already-created document. The runner awaits it, optionally writes its trace, and always awaits close. Paths are relative to the process working directory.

```ts
import type { SemanticDocument } from "cadara-cli/sdk";

export default async function model(doc: SemanticDocument) {
  await doc.ops.document.rename({ label: "Example plate" });
  await doc.ops.variable.add({ name: "thickness", valueText: "4" });
  await doc.ops.sketch.begin({ plane: "xy" });
  await doc.ops.sketch.author({
    primitive: { kind: "rectangle", start: [0, 0], end: [40, 20] },
    construction: false,
  });
  const published = await doc.ops.sketch.publish({ requireProfiles: true });
  const owner = { kind: "sketch", sketchId: published.discovery!.sketch!.sketchId! } as const;
  const profile = doc.references({ owner, kind: "region" })[0]!.target;
  await doc.ops.extrude.create({ profile, depth: "thickness" });
  const probe = await doc.probe([{
    operation: "variable.update",
    fields: { variableId: { label: "thickness" }, name: "thickness", valueText: "6" },
  }]);
  if (probe.results[0]?.outcome.kind !== "completed" || probe.cleanup.kind !== "closed" || probe.facts.bounds[0]?.max[2] !== 6)
    throw new Error("Thickness probe did not certify the requested rebuild");
  await doc.ops.document.save({ path: "plate.cadara" });
  return { facts: doc.inspect(["bounds", "topologyCounts"]), probe: probe.facts };
}
```

This deliberately small example is not a fully constrained sketch: its XY size and position remain free. Use driving dimensions, expressions and geometric requirements for design intent; see README operation sections and the modelling skills. `examples/sdk-plate.js` is the runnable equivalent.

**Trusted code only.** `script` executes ordinary Bun JavaScript/TypeScript with your process permissions, filesystem and network access. It is not sandboxed, time-bounded or a persistent runtime. Run only code you trust, inside your normal external sandbox. TypeScript is transpiled, not typechecked, by Bun; run your TypeScript checker when static assurance is needed. Scripts should return JSON-compatible values and use stderr for their own logs if they need one parseable stdout envelope.

The runner prints `{version:1,value,results,cleanup,error?}`. `results` retain every terminal outcome, completion receipt and diagnostic without full intermediate discovery. Exit 0 means the script returned and cleanup closed, **not** that caught refusals or accepted-invalid geometry fulfilled a modelling request. Exit 1 is a script/semantic/selection/trace/cleanup failure; unexpected programming exceptions remain observable with their stack on stderr. Exit 2 is invalid invocation. `--trace` is written even after a script throws, if the attempted commands are portable; a trace-write/export failure also fails the command. No automatic native save occurs.

## Own a document directly

```ts
import { openCadara } from "cadara-cli/sdk";
const doc = await openCadara({ path: "plate.cadara" }); // or { label: "New part" }
try {
  await doc.ops.variable.update({ variableId: { label: "thickness" }, name: "thickness", valueText: "8" });
  await doc.ops.document.save({ path: "plate-thick.cadara" });
} finally {
  const cleanup = await doc.close();
  if (cleanup.kind !== "closed") throw new Error(JSON.stringify(cleanup));
}
```

`openSemanticDocument(factory)` attaches the SDK to an application `SemanticSessionFactory`, including its initialization receipt and isolated-copy factory. `new SemanticDocument(session, initialState?, openCopy?)` is the lower-level seam for an existing session. Such attached sessions must explicitly start with `document.create` or `document.open` before their traces can be exported/replayed. The SDK never owns a second model/history store.

## Operations and handles

- `doc.ops.extrude.create(fields)` and `doc.op("extrude.create", fields)` are the same call. The nested functions are generated from the closed `SemanticCommand` union, including operations sharing a union arm (`history.undo`/`redo`, `export.svg`/`dxf`). `OperationId` and `OperationFields<Id>` are exported for generic callers. No manually maintained fluent modelling API exists.
- Omit `version`, `commandId`, `basis` and `draft`. IDs are generated per session; basis/draft chain from the actual terminal live state, **including a failed operation that applied state**. Geometry intent defaults to `fulfill`; explicit `intent: "author-invalid"` is available only where the contract permits it. Other modelling fields are unchanged.
- Every returning operation yields a `SemanticHandle` with `.result`, `.discovery`, `.ops` and `.op`. `doc.op` uses current authority. `handle.op` uses that handle's authority: reusing an old handle deliberately produces the same conflict as a stale recipe basis/draft. A handle is not a branch, transaction or rollback point. Selection still uses live discovery.
- Await calls in order. SDK calls are serialized and automatically chain inside the queue. The underlying session remains the sole serial modelling executor. Do not concurrently mix the low-level adapter `execute`/`replay` with `op`.
- `doc.canRun(id)` polls the current discovery capability matrix and, for exports, the advertised `exportProviders` formats. False also means unknown capability/discovery or a closing document. True is not a guarantee that the current editing context, targets or options are valid.
- `doc.current` is the last terminal handle. Its discovery is null after an uncertified handoff; queries never silently reuse an earlier snapshot as current. `.results()` returns every terminal result, including failures; `.commands()` returns copies of the successful or live-applied commands eligible for the recipe trace.

For the exact modelling fields and units, run `cadara document recipe --schema <operation>` and read README. Lengths use document units (the shipped headless composition uses millimetres); angles vary by field. SDK types extend the same contract with shared selectors, not a second set of parameters.

### Outcomes and errors

| Outcome | `op` / generated `ops` |
| --- | --- |
| `completed` | returns a handle |
| `canceled` | returns a handle; it does **not** certify application |
| `accepted-invalid` | returns only with explicitly requested `author-invalid`; never usable-geometry success |
| `rejected`, `conflicted`, `unavailable`, `failed` | throws `SemanticOperationError` with the full `.result` (diagnostics, actual state and every receipt) |
| selection missing/ambiguous | throws `SelectionError` with `.selection` (eligible kinds, candidates with owners, available entries); no command executed and no fabricated semantic result |

`await doc.tryOp(id, fields, options?)` returns the discriminated union `{ok:true,handle}` or `{ok:false,error}` for semantic/selection failures only. It does not toggle shared exception policy. Invalid JS input, malformed completion certificates and programming exceptions still throw. `SemanticInitializationError.initialization` preserves startup diagnostics and cleanup. Optional `{signal}` uses the session cancellation contract: no preemption or rollback of synchronous native work is promised.

## Selection and queries

All operation selection goes through the application resolver. Use `{label:"Outer region"}` against **live** discovery, an owner-qualified `publishedHandle.ref("Outer region")` (or `{label,sketch:"earlier-recipe-alias"}` in the recipe adapter), or an exact discovered typed target. Missing and ambiguous selection never chooses the first match. Exact body lists and bounded extrude/revolve start/end targets accept the same shared selectors. After edits, rediscover references rather than assuming old topology is still current.

```ts
const regions = doc.references({ owner: sketchTarget, kind: "region" });
const faces = doc.topology("face");
const planar = faces.filter((f) => f.geometryType === "plane");
// Each topology entry includes its exact `reference: {label,target,owner}`.
const facts = doc.inspect(["bodies", "bounds", "topologyCounts", "features", "variables", "solveStatus"]);
```

`references({owner?,kind?})` matches the exact sketch/feature/body owner **and the owner's own root target**, like `document.inspect.owner`. A kind filter narrows the target's TypeScript type. `topology(entityClass?)` joins native topology to selectable references by identity, never display meshes. Missing native topology is unknown (`topologyCounts: null` per body), not zero faces. `inspect(fields?)` returns only the requested fact groups (all groups by default); it reads the last certified discovery without executing a command. To explicitly refresh or use semantic scoped inspection, call `ops.document.inspect({owner: typedOwnerOrSelector})`.

`doc.localToWorld([x,y])` embeds plane-local sketch coordinates using the discovered support frame. `doc.worldToLocal([x,y,z])` orthogonally projects onto that frame and returns local XY; off-plane distance is discarded. Both throw when no sketch support frame is discovered. Face-backed frames can have translated/rotated axes: always convert through the frame, rather than treating world XY as sketch coordinates.

## Disposable parametric verification

`doc.probe(edits)` accepts ordered `variable.update` or `sketch.dimension.update` field objects and returns `{results,replayResults,facts,cleanup}`. It reconstructs the recorded source into a **different isolated session**, omitting native saves and exports, applies the edits there, reports actual outcomes/receipts and compact discovery, and closes that copy. It never edits, saves or advances the source handle/state/trace. The original input files/images must remain available and unchanged; reconstruction is not a filesystem snapshot. For dimension probes, leave/open the relevant draft before probing so the replay reconstructs its authority.

Check every edit outcome, geometry/currentness receipt, resulting dependent facts and cleanup. A successful variable update alone does not prove the expected geometry moved. A failed edit stops the probe's edit sequence and is returned, not misreported as success. A replay or selection/programming failure throws after closing the copy. Probes accept portable authoring traces even after caught errors: failed calls that did not apply state are absent from the recipe. There is no separate repaired-trace refusal; an actual replay failure still throws. Selectors are resolved against source discovery before remapping into the copy, so handle-qualified dimension selectors remain valid when saves/exports are omitted. Full native-copy probes for sessions without a portable authoring trace are not part of v1.

## Trace and replay

`doc.commands()` and the recipe trace record **successful or committed commands**: `completed` (including successful saves, exports and inspection), `accepted-invalid` under explicit `intent: "author-invalid"`, or any result with `completion.live.kind === "applied"`. Calls that neither succeed nor apply live state—including not-applied failures, rejections, conflicts, unavailable/canceled calls—and selection/shape errors or programming exceptions produce no recipe step. Semantic failures still retain their full result/diagnostics in `SemanticOperationError.result` and `doc.results()`. `doc.trace()` exports `{version:1,operations:[...]}`, using recipe aliases, owner-qualified labels and generated basis/draft provenance instead of session-random IDs. `await otherDoc.replay(trace)` and `cadara document recipe trace.json` use the same SDK/resolver execution seam.

**V1 portability restriction (deliberate decision):** if a recorded command's reference is not uniquely label-selectable (same-owner duplicate labels, or a session-scoped spline tangent handle), exporting the recipe throws **`SemanticTraceError`** naming `.commandId`, `.operation` and `.reference`. The complete recorded-command log remains available. Undiscovered typed refs are refused as non-label-selectable too; the recorder re-resolves and validates exported commands so an unsupported selector path cannot silently produce an invalid recipe. Name references unambiguously before use when possible; the SDK never invents an ordering-based identity. Full provenance encoding is tracked in `cadara-kkl.17`.

Ordinary recipes still stop at the first non-completed/non-accepted-invalid outcome. When caught errors did not apply state, exported traces omit those calls and replay reproduces the script's final model. A **failed-but-live-applied** edit remains in history: replay halts there in the genuinely failed document state. This is faithful document history, not a replay of the script's catch/continue control flow; no recovery or snapshot semantics are implied. Cancellation signals and programming crashes are not serialized as artificial semantic outcomes. Input files must be retained; output paths are replayed literally and may overwrite files. Treat a trace like an executable batch, not a portable asset archive.
