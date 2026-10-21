---
name: cadara-cli-modelling
description: Execute CADara recipe files or replay SDK traces in batch/CI. Use to inspect a saved model with a recipe, interpret envelopes and exit codes, choose compact output, or query --schema.
---

# CADara recipe reference

Use this skill for existing JSON recipes and SDK trace replay. To author or edit a part through a script, start with [SDK modelling](../cadara-sdk-modelling/SKILL.md); its [Design intent](../cadara-sdk-modelling/SKILL.md#design-intent) also governs models represented by recipes.

`<cli>` is a complete built package directory; source docs/examples live in `src/cli/`. Read `<cli>/README.md` for operation fields, selector rules and units, `document recipe --help` for invocation, or `document recipe --schema [operation]` for generated contracts and capabilities. These queries leave the modelling kernel idle. For package acquisition/building, see the SDK workflow's first step.

## Workflow

1. **Review inputs and outputs.** Retain input `.cadara` files/images required by the recipe or trace. Paths resolve against the process working directory; replay executes recorded writes literally and can overwrite files. Ensure output parent directories exist. Read README sections for operations you change; inspect generated contracts with `bun <cli>/main.js document recipe --schema <operation>`.
2. **Choose evidence detail.** Use default detailed output for native topology or intermediate sketch discovery. Use `--output compact` when outcomes, receipts, diagnostics and final labelled references/bounds suffice. See `<cli>/README.md`, **Compact output**, for the versioned omission contract; compact reduces printed bytes, not native work.
3. **Execute and retain evidence.** `bun <cli>/main.js document recipe recipe.json >out.json 2>err.txt; echo $?`. For batch/CI compact output: `bun <cli>/main.js document recipe --output compact recipe.json >out.json 2>err.txt; echo $?`. Keep the recipe, exit code and both channels with delivered files.
4. **Judge the envelope.** Apply [Failure signals](#failure-signals) and the shared [Outcomes and receipts](../cadara-sdk-modelling/SKILL.md#outcomes-and-receipts). Recipe fulfillment additionally requires `unexecuted: []`. Account for every intended operation and file; a completed prefix is not the completed job.
5. **Report.** State the failing `commandId`/operation, outcome, completion facets and diagnostics, or the cleanup/initialization failure if no command caused it. For a successful replay report native/export paths and written receipts, checked geometry and any parametric limitations supplied by the model's design intent.

## Failure signals

Each runtime-started invocation prints one JSON envelope on stdout. A recipe stops at the first failure, retaining earlier changes without rollback. Exit 0 alone is insufficient; semantic outcomes, receipts and cleanup have their shared interpretation in [SDK Outcomes and receipts](../cadara-sdk-modelling/SKILL.md#outcomes-and-receipts).

| Signal                                                                         | Where to read the evidence                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| exit 2, empty stdout                                                           | Nothing ran. Parse the first stderr line as `{version:1,error}`; inspect command/path, expected schema or suggestions. A human summary follows.                                                        |
| exit 1, stdout `error.code: "selection-unresolved"` or `"selection-ambiguous"` | Read `error.path`, `selector`, owner-bearing `candidates`, or `available`/`availableCount`. `unexecuted[0]` is the failing command: it and the remaining suffix never ran and have no semantic result. |
| exit 1, a non-completed semantic result                                        | Inspect the last result's outcome, `diagnostics` and separate completion facets, then cleanup. The semantic outcome table is in the SDK reference above.                                               |
| exit 1, all operations completed                                               | Inspect `cleanup.kind`, `failures` and `diagnostics`; teardown alone may have failed.                                                                                                                  |
| exit 1, `initialization`, `results: []`, `error.code: "initialization"`        | Runtime startup failed; inspect initialization diagnostics and cleanup.                                                                                                                                |
| exit 0, `accepted-invalid` among results                                       | The recipe runner permits explicit author-invalid results. Use the shared outcome criteria to report invalid geometry rather than fulfillment.                                                         |

For the complete structured `error` fields, read `<cli>/README.md`, **Errors and exit codes**. Keep envelope-level selection errors separate from semantic result diagnostics. Repository commitment is distinct from file delivery; see the shared receipts reference before accepting saves or exports.

## Reading or editing an existing recipe

A recipe has `{version:1|2,operations:[...]}`. New SDK traces always emit v2; current readers replay unchanged v1, but old v1-only binaries explicitly refuse v2. Per-operation semantic versions and native files stay unchanged. Each operation has a unique `commandId`; `as` gives its result a recipe-local alias. `basis`/`draft` aliases identify immutable authority snapshots, not live variables; an older authority can conflict even if a target still exists.

For v2 `recipeRef` targets, read README **Recipe versions and creation-output references** before editing. Preserve producer/owner/output slots: they identify supported authored creations, independent of labels or discovery order. Tangents use the spline's ordered fit-point occurrence slot, including repeated points, and resolve fresh handles after reopen. Unavailable outputs and pre-existing ambiguous asset references refuse explicitly. Keep structured command/path/reason evidence; semantic slots are not first/last discovery matches. Probes preserve bindings while omitting writes. `--schema` exposes both readable versions and the generated transport/reference shapes.

Use `<cli>/README.md`, **Typed targets and owner-scoped discovery** and **Sketch-owner-qualified target selectors**, when reading/editing target fields. Resolve ambiguity by intended sketch owner or an exact discovered typed target; published geometry uses the publish alias as owner. For full basis/draft encoding and operation shape, consult the README and generated schema rather than hand-building a chain from guessed IDs.

## Inspect a saved model

Use a two-operation recipe instead of rebuilding the model:

```json
{
  "version": 1,
  "operations": [
    {
      "version": 1,
      "commandId": "open",
      "operation": "document.open",
      "path": "part.cadara",
      "basis": null,
      "as": "opened"
    },
    {
      "version": 1,
      "commandId": "inspect",
      "operation": "document.inspect",
      "basis": { "alias": "opened" }
    }
  ]
}
```

Read the final discovery; add `document.inspect.owner` when only one owner's references are needed. Its filter narrows `references`, not model/draft metadata. A reopened document has fresh editing authority and no restored private undo history.

## Qualified recipe example

`<cli>/examples/multi-sketch-part.json` is qualified by `src/cli/modelling-skill-recipes.spec.ts` against the built package. It extrudes a 40×20 XY plate to depth 4, joins a 20×30 YZ wall using owner-qualified profiles, updates wall depth from 4 to 6, renames the body `L bracket`, saves `l-bracket.cadara`, reopens it, and exports STEP/STL.

Expected evidence: one body bounded by `[0,0,0]`–`[40,20,30]`, eight planar faces, and the wall's inner face at x = 6 spanning z = 4–30. Bounds alone do not prove that edit. Reopened geometry and the body label agree, `history.canUndo` is false, and save plus both exports have written file receipts. This is an execution/selection example, not proof of fully constrained design intent.

## Debug retained evidence

Extract only needed facts from the retained envelope, for example:

```sh
jq -c '.unexecuted, .cleanup, (.results[] | [.correlation.commandId, .outcome, .completion.file.kind])' out.json
```

Detailed discovery carries native bounds/topology in `discovery.model.bodies`, labels in `discovery.references`, and feature outputs in `discovery.model.features[].producedTargets`. Keep full output on disk rather than rerunning for each query. For modelling corrections, bounded capabilities and defect-hiding workarounds, use the SDK skill's **Debugging within bounds** and **Workarounds that hide defects** sections.
