---
name: cadara-sdk-modelling
description: Model native CADara parts with the shipped TypeScript SDK. Use when writing or running SDK scripts, querying live model references, checking disposable parametric probes, or exporting replayable recipe traces.
---

# CADara SDK modelling

Use the typed SDK for live in-script discovery and basis/draft chaining. The modelling semantics and receipts are the same as CLI recipes; an SDK handle is not a transaction or rollback point.

## Authorities

`<cli>` is the built CLI package directory. Read `<cli>/SDK.md` for API, outcome/throw mapping, probe and trace limits; `<cli>/README.md` for the fields/units of each modelling operation; `<cli>/COVERAGE.md` for the closed operation inventory. `bun <cli>/main.js document recipe --schema <operation>` prints a generated contract. Source equivalents are under `src/cli/`.

Read the **Design intent** section of the sibling [CLI modelling skill](../cadara-cli-modelling/SKILL.md) before authoring: variables must drive dimensions/features, sketches express relationships and position/orientation as well as size, and profiles/parts should be named by purpose. SDK types are imported from `cadara-cli/sdk` (or the provided built `sdk.js`); use the installed package for consumer typechecking.

## Workflow

1. **Use a built package.** If no package was provided, build once: `bun scripts/build-cli.mjs /tmp/cadara-cli`. Keep the complete directory including shared JS chunks, `occ/`, docs and types. Build/source startup is expensive; run the bundle for modelling.
2. **Write one script** default-exporting `async (doc) => value`. The command gives you a fresh already-created document. Use `doc.ops.document.open({path})` to continue a saved model. `doc.ops.<operation>(fields)` and `doc.op("operation",fields)` auto-chain identity/basis/draft and default geometry intent to `fulfill`. Use a stale handle's `.ops` only when deliberately testing conflict; normal sequential work goes through `doc.ops`. See `<cli>/examples/sdk-plate.js` for a qualified minimal example (its XY sketch remains underconstrained).
3. **Select from live evidence.** `doc.references({owner,kind})` scopes by a discovered sketch/feature/body target and narrows the type. Read `.current.discovery` for exact targets/solver status, `doc.topology("face"|"edge")` for native topology joined to selectable references, and `doc.inspect(["bounds","topologyCounts",...])` for compact facts. `{label}` selectors use the shared resolver and throw candidates on ambiguity. For face-backed sketches convert coordinates with `doc.worldToLocal`/`localToWorld`; their frame need not align with world XY.
4. **Probe design intent before saving.** `await doc.probe([{operation:"variable.update",fields:{variableId:{label:"width"},name:"width",valueText:"80"}}])` reconstructs an isolated copy, omits saves/exports, applies edits, returns `results`, `facts` and `cleanup`, and leaves source authority/trace unchanged. Check that every edit completed with current geometry and the expected dependent bounds/topology/positions moved. Keep original input files/images unchanged while probing. For dimension probes open/leave the relevant draft before probing. A probe needs a successful portable authoring prefix; it is not a repair mechanism for a failed history.
5. **Save/export explicitly**, then check the returned `.result.completion.file` is `written` with the intended path and bytes. The runner does not automatically save. Return only concise JSON-compatible evidence, with no extra stdout logs.
6. **Run and retain evidence:** `bun <cli>/main.js script model.ts --trace model.recipe.json >out.json 2>err.txt; echo $?`. This is trusted Bun code with process permissions, **not sandboxed**; use the normal external sandbox. Bun transpiles TS without checking it. Keep the exit code, output, error and trace beside the delivered files.
7. **Judge all outcomes**, not just exit 0. `completed` returns; `canceled` returns but did not apply; `accepted-invalid` returns only for explicit author-invalid and is not usable geometry. Other semantic outcomes throw `SemanticOperationError.result`; selection errors throw `SelectionError.selection` with candidates/owners. `tryOp` returns `{ok:true,handle}` or `{ok:false,error}` for those failures only. Programming errors still throw. Caught failures can coexist with exit 0: inspect all runner `results` and `cleanup`, and report any failure rather than claiming fulfillment.
8. **Replay when portable:** `bun <cli>/main.js document recipe model.recipe.json`. Trace export records the failed command but throws typed `SemanticTraceError` (step, operation, reference) for same-owner duplicate labels, undiscovered typed references or session-scoped tangent handles that cannot be uniquely label-selected. The complete `doc.commands()` log still exists. Name ambiguous references before using them when possible. Recipes stop at the first failure; a script that catches and repairs a failure has a trace with an unexecuted replay tail, not a fully replayable repaired result. Keep input assets and review output paths before replay, which can overwrite files.

## Completion

Report delivered native/export paths and observed written receipts, every semantic/selection/cleanup failure, the independent design variables and assumptions, any remaining sketch freedom, the exact edit probes and resulting dependent facts, and whether the trace exported and replayed. Exit 0, nominal bounds or a bare variable-update success alone do not prove parametric fulfillment. Fully constrained claims require a successful solve, `wellConstrained`, and intentional relationships—not fixed snapshots. Direct `openCadara` callers must await `close()` in `finally` and inspect its cleanup result.

## Qualified workflow

`src/application/semantic/sdk-reference-extents.spec.ts` additionally qualifies native extent/body-list trace and probe portability. `src/cli/sdk-scripts.spec.ts` qualifies the shipped package outside the checkout: generated namespaced calls, live owner-scoped profile selection, typed semantic errors (including `instanceof` across script/package boundaries), disposable edit probes, native save, STEP export, direct SDK reopen, failed-step CLI trace replay, and independent consumer typechecking. It also runs the shipped `examples/sdk-plate.js` from this workflow. `evaluations/agent-modelling/verify-sdk-references.sh` runs the unchanged five reference parts and independent checker through the shipped script/SDK seam.
