# Add Sheet-Tool Split

## Why

`add-surface-body-modeling` made sheet bodies first class and then locked every solid-only feature
path behind `requireSolidBody`, split included. `add-onshape-surface-extrude-import` then made the
first real sheet producer importable, so the captures now contain a sheet body whose only consumer is
a split. `9841e486906fa2ce62d74d8e` `Split 1` (`featureType: splitPart`, `splitType: PART`,
`keepBothSides: true`, `keepTools: false`) splits one solid with the sheet body created by that
studio's `Extrude 4` surface extrude. Splitting a solid with a surface is the normal Onshape and
Plasticity workflow — a sheet tool is the *reason* the sheet exists — and today it fails with
`advanced-feature-unsupported-kernel-case: OCC split does not support sheet body <id>`.

The kernel split path is also wrong for a sheet tool independently of the guard: it is implemented as
`BRepAlgoAPI_Cut` plus `BRepAlgoAPI_Common` (remainder plus tool-side), which is solid/solid boolean
semantics. A sheet has no volume, so cut returns the target unchanged and common returns nothing.
Splitting a solid by a surface is `BRepAlgoAPI_Splitter`, which is not bound in the custom OCC build
yet.

Assumptions, stated explicitly:

- The split TARGET stays solid-only. Splitting a sheet by anything is out of scope, and a sheet
  target keeps its existing explicit diagnostic.
- Only the single-tool-body split form already implemented is extended; plane tools, face tools, and
  multi-tool splits keep their current explicit rejections.
- The custom Wasm build must be rebuilt for the new `BRepAlgoAPI_Splitter` binding and the new native
  shim branch. No JavaScript-side emulation of splitting is added as a stopgap, and no compatibility
  or deprecation shim is added anywhere.
- The Onshape importer is not changed: its split translator, planner, and provider emission carry no
  solid-only body assumption, so the sheet tool body reference already flows once the kernel accepts
  it. `Split 1` promotion still depends on live history-probe evidence exactly like every other
  topology consumer.

## What Changes

- Accept a sheet body as the split TOOL in the OCC kernel while keeping the target solid-only.
- Execute a sheet-tool split with `BRepAlgoAPI_Splitter` instead of cut-plus-common, in both the
  native transaction shim and the JavaScript fallback, and bind `BRepAlgoAPI_Splitter` in the
  OpenCascade recipe.
- Keep `keepTools` semantics identical for a sheet tool: a consumed sheet tool body is removed from
  the document exactly like a consumed solid tool body.
- Report split topology references invalidated by a sheet-tool split as ambiguous or deleted through
  the same history path used by the solid-tool split.
- Update split authoring copy so the tool participant no longer claims it must be a solid body.

## Capabilities

### Modified Capabilities

- `split-delete-solid-feature`: the split tool participant accepts a solid or a sheet body, the
  target stays solid-only, and a sheet-tool split executes as a splitter operation whose result
  bodies obey `keepTools`.
- `surface-body-substrate`: solid-only rejection no longer covers the split tool position; split
  remains solid-only everywhere else.

## Impact

- Affected code: `src/domain/modeling/occ/features/combine-split-delete.ts`,
  `src/domain/modeling/occ/features/boolean-operations.ts`,
  `src/core/feature-authoring/features/split.ts`,
  `occ-native-shims/cadara-execute-native-feature-transaction.inc`,
  `occ-native-shims/cadara-native-topology-helpers.inc`,
  `occ-native-shims/cadara-native-topology-preamble.inc`, and `opencascade-recipe.yaml`.
- Not affected: the contract layer (advanced-solid split participants are kind-agnostic durable body
  refs), the mock kernel adapter (it never modelled body kind), and the Onshape importer.
- Testing impact: logic lane only. The sheet-tool kernel specs are gated on the rebuilt custom Wasm
  because the splitter binding and the shim branch do not exist in the committed `public/cadara-occ.*`
  artifacts.
