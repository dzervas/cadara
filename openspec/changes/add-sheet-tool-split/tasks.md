## 1. Bind and implement the splitter in the custom OCC build

- [x] 1.1 Add `BRepAlgoAPI_Splitter` to `mainBuild.bindings` in `opencascade-recipe.yaml` and include `BRepAlgoAPI_Splitter.hxx` in the shim preamble.
- [x] 1.2 Branch `BuildSplitCommittedShapeTransactionWithHistory` on the tool's `ShapeType()` without changing its signature, running `BRepAlgoAPI_Splitter` for a shell or face tool and keeping cut-plus-common otherwise.
- [x] 1.3 Build the splitter branch's history JSON through the existing `CadaraBuildSplitFeatureHistoryJson` template with the splitter as both builder arguments, and reuse the existing failure-diagnostic payload shape.

## 2. Accept a sheet tool in the kernel split path

- [x] 2.1 Keep the split target on `requireSolidBody` and resolve the tool with `requireBody` so a solid or sheet tool is accepted and a sheet target still fails explicitly.
- [x] 2.2 Add a `runSheetSplit` helper beside `runBoolean` that drives `BRepAlgoAPI_Splitter` with argument/tool shape lists and returns the result shape, builder, and history sources.
- [x] 2.3 Execute the JavaScript fallback for a sheet tool through `runSheetSplit`, tracking the single split result compound and preserving `keepTools` and split-ambiguous invalidation behavior.

## 3. Align authoring copy

- [x] 3.1 Update the split authoring tooltip and tool-participant helper copy so the tool body may be a solid or a sheet body.

## 4. Prove it

- [x] 4.1 Add kernel specs for a sheet-tool split over a solid target: two solid results, `keepTools` kept and consumed, and a sheet target still rejected; gate the specs that need the splitter binding on the committed custom build exposing it.
- [x] 4.2 Add an authoring spec asserting the split tool copy accepts sheet bodies.
- [x] 4.3 Run `bun x tsc -b tsconfig.app.json --noEmit`, `bun run lint`, `bun run test:logic`, and `bun run test:static`, and record which specs stay gated until the Wasm rebuild.
