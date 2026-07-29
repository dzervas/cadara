## Context

`executeSplitFeature` in `src/domain/modeling/occ/features/combine-split-delete.ts` resolves exactly
one `targetBody` participant and exactly one `toolBody` participant, then runs one of two paths:

- the native path, `CadaraExecuteNativeFeatureTransaction.BuildSplitCommittedShapeTransactionWithHistory`,
  whose shim builds `BRepAlgoAPI_Cut` plus `BRepAlgoAPI_Common` over the same target/tool pair and
  concatenates both results into one compound; or
- the JavaScript fallback, which runs `runBoolean("cut", …)` and `runBoolean("intersect", …)` and
  tracks the remainder and tool-side solids separately.

Both paths currently resolve the tool with `requireSolidBody`, which rejects sheet bodies. Both are
also semantically wrong for a sheet tool: a zero-volume tool makes cut a no-op and common empty.

OCC's answer for "split a shape by a shape of lower dimension" is `BRepAlgoAPI_Splitter`
(`BOPAlgo_Splitter`): arguments are the objects to split, tools are the splitting shapes, tools are
never present in the result, and the result is the target subdivided — for a solid split by a shell or
face that crosses it, two solids. The custom OCC build does not bind `BRepAlgoAPI_Splitter` today,
only `BRepAlgoAPI_BuilderAlgo` (general fuse) and the three boolean operations, so this change adds
the binding and therefore requires a Wasm rebuild.

## Goals / Non-Goals

**Goals:**

- Accept a sheet body in the split tool position, in the kernel and in authoring copy.
- Execute a sheet-tool split as one `BRepAlgoAPI_Splitter` operation in the native shim and in the
  JavaScript fallback.
- Preserve `keepTools` and topology-invalidation behavior for sheet tools.

**Non-Goals:**

- Split a sheet target, split with plane or face tools, split with several tool bodies, or keep only
  one side of a split.
- Emulate splitting with the currently bound booleans so the feature "works" before the rebuild.
- Change the Onshape importer, the contract layer, or the mock kernel adapter.

## Decisions

1. Only the tool guard moves.

   `getSplitTargetBody` and `getSplitToolBody` stay as they are: participant shape and cardinality
   rules are unchanged. In `executeSplitFeature` the target keeps
   `requireSolidBody(context, targetBodyRef.bodyId, "split")` and the tool becomes
   `requireBody(context, toolBodyRef.bodyId)`. `BodyKind` is exactly `"solid" | "sheet"`, so a plain
   `requireBody` is the accurate expression of "solid or sheet" and needs no extra branch. Sheet
   target plus sheet tool therefore still fails on the target guard with the existing diagnostic.

2. The native shim branches on the tool's `ShapeType`, keeping its signature.

   `BuildSplitCommittedShapeTransactionWithHistory` keeps its exact parameter list, so the JavaScript
   call site is unchanged and the entrypoint capability probe is unaffected. Inside, a tool whose
   `ShapeType()` is `TopAbs_SHELL` or `TopAbs_FACE` takes the splitter path; anything else keeps the
   existing cut-plus-common path. Branching on shape type rather than on a new parameter keeps the
   native binding surface and its probe list stable.

3. The splitter path reuses the existing split history JSON builder with one builder.

   `CadaraBuildSplitFeatureHistoryJson` is a template over `CutBuilder`/`CommonBuilder` and only ever
   calls `Modified`, `Generated`, and `IsDeleted` on them, unioning successors (deduplicated by final
   shape index) and treating a subshape as deleted only when *both* builders deleted it. Passing the
   single splitter as both arguments therefore evaluates to exactly the single-builder semantics —
   union of that builder's modified/generated successors, deleted when that builder deleted the
   subshape — so no second history builder variant is introduced. `BRepAlgoAPI_Splitter` derives from
   `BRepAlgoAPI_BuilderAlgo`, which provides all three methods plus `SetToFillHistory`,
   `SimplifyResult`, and `IsDone`, so the template instantiates unchanged.

   Every surviving reference is reported `ambiguous` and every vanished one `deleted`, which is the
   same conservative naming the solid-tool split already produces, and matches the JavaScript
   fallback's `markSplitAmbiguousInvalidations`.

4. The JavaScript fallback gets a `runSheetSplit` helper next to `runBoolean`.

   ```text
   runSheetSplit(oc, target, tool)
     arguments = TopTools_ListOfShape_1(); arguments.Append_1(target)
     tools     = TopTools_ListOfShape_1(); tools.Append_1(tool)
     splitter  = new oc.BRepAlgoAPI_Splitter_1()
     splitter.SetArguments(arguments); splitter.SetTools(tools)
     splitter.SetToFillHistory(true); splitter.Build(progress)
     -> throws when !IsDone()
     splitter.SimplifyResult(true, true, 1e-7)
     returns { shape: splitter.Shape(), builder: splitter, historySources: [splitter] }
   ```

   Unlike `runBoolean` the result is not passed through `refineBooleanResultShape`: unifying
   same-domain faces across a freshly split result risks merging the two coincident split faces that
   belong to the two result solids, which is exactly the topology the feature just created. The native
   splitter path likewise only runs `CadaraPrepareCommittedShape`.

   The split result is one compound of solids, so it is tracked with a single
   `trackBodiesFromShape(…, "split")` call — the same shape and suffix the native path already uses —
   instead of the fallback's separate `remainder`/`tool-side` tracking.

5. Recipe binding.

   `BRepAlgoAPI_Splitter` is added to `mainBuild.bindings` in `opencascade-recipe.yaml` in
   alphabetical position after `BRepAlgoAPI_Fuse`, and `BRepAlgoAPI_Splitter.hxx` is added to the shim
   preamble includes beside the other explicitly included headers. `TopTools_ListOfShape` is already
   bound and already used by the shims, so no list binding is needed.

## Risks / Trade-offs

- The feature cannot execute until the custom Wasm is rebuilt: the native shim branch and the
  `BRepAlgoAPI_Splitter` binding both live in the build artifact. Mitigation: the kernel specs that
  need the splitter are gated on the committed build actually exposing the binding, so the suite stays
  honest instead of green-by-omission, and the gate lifts by itself after a rebuild.
- The shim change cannot be compiled in this repository. Mitigation: the branch reuses the existing
  diagnostic, prepare, and history helpers verbatim and introduces no new template or type.
- A sheet tool that does not fully cut through the solid produces one result body rather than two.
  That is OCC's honest answer and is left as is; `trackBodiesFromShape` already throws when the result
  contains no solid at all.

## Migration Plan

None. No persisted contract, schema version, or stored definition changes; the same split definitions
that exist today either keep working (solid tool) or stop failing (sheet tool).

## Open Questions

None.
