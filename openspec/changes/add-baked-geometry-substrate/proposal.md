# Add Baked Geometry Substrate

## Why

The Onshape importer's `baked` tier plans and reports honestly but cannot materialize: `ImportCapabilities.bakeGeometry` is an unimplemented stub, no `FeatureDefinition` variant places externally-sourced geometry as a body, and the OCC path has no import route for foreign geometry. The consequence is user-facing and measured: Taskariki (41 features) imports with **no visible solid at all** — 35 baked features are suppressed placeholders. For complex models the importer currently looks broken even when it is being maximally honest.

This substrate is deliberately generic: the archived `mesh-baked-geometry-import` spec (STL/3MF file imports) was never implemented for lack of exactly these pieces, and every future importer needs "place this externally-produced geometry as a durable body" as a primitive. Capture bundles already carry ground-truth tessellation and STEP text; the OCC wasm build has a STEP writer but **no STEP reader**, so the v1 bake path is tessellation-based, with exact STEP baking gated behind a recipe extension.

## What Changes

- Add a **`bakedBody` feature kind** to the modeling contract: a feature whose rebuild output is a body materialized from a referenced geometry asset (`baked-mesh` v1; `baked-occ`/`cadara-brep`/`step` as formats land). Baked bodies are selectable, renderable, exportable, and usable as boolean/reference targets like any body; their internal geometry is not parametrically editable and the feature says so.
- Implement **`ImportCapabilities.bakeGeometry`** end-to-end: bytes+format → validated, deduplicated (content-hash) geometry asset in the existing `GeometryAssetStore`, returning the asset id.
- Implement **kernel support** for `bakedBody` in both adapters: mock (logic lane) and OCC — mesh assets become faceted kernel bodies with durable topology ids so downstream references and exports work.
- Update the **Onshape provider**: studios requiring a bake emit a `bakedBody` feature from the bundle's ground-truth tessellation (whole-studio final body in v1; per-feature deltas when capture v2 lands), replacing the `onshape-bake-unavailable` warning. Baked features appear in the feature tree suppressed-but-visible with their reason codes; the baked body itself is live geometry.
- Gate (not implement) **exact STEP baking**: a task verifies the effort to add `STEPControl_Reader` to `opencascade-recipe.yaml`; if cheap it lands as a follow-up format, otherwise it is documented and deferred.

Out of scope: mesh→B-rep reconstruction (`reconstructMeshToBrep` stays a stub), STL/3MF file import providers (enabled by this substrate, drafted separately if wanted), per-feature bake deltas (capture v2), and full portable embedding of baked assets in single-file Cadara exports. Minimum guard for portable export in this change: exporting a document whose `bakedBody` asset cannot be embedded must emit a loud diagnostic rather than silently producing a geometry-less file.

## Capabilities

### New Capabilities

- `baked-body-feature`: The `bakedBody` feature kind — definition, kernel materialization, downstream usability, and its honesty constraints.

### Modified Capabilities

- `import-provider-contract`: `bakeGeometry` becomes a working capability with specified validation, dedup, and failure semantics (contract shape unchanged; the requirement that it exists-or-is-absent honestly gains an implemented-platform scenario).
- `onshape-import-provider`: baked-tier planning materializes geometry via `bakedBody` instead of emitting `onshape-bake-unavailable`.

## Impact

- Affected code: `src/contracts/modeling/schema.ts` (+ runtime schema) for the feature variant, `src/domain/modeling/mock-kernel-adapter.ts`, OCC adapter + worker + a mesh-to-shape path in `src/domain/modeling/occ/`, `src/domain/import/orchestrator.ts` (implemented `bakeGeometry` wiring through the asset store), `src/domain/import/onshape/provider.ts` + planner, feature tree presentation for baked features.
- Dependency impact: none new for v1 (tessellation path); STEP reader would require a custom OCC wasm rebuild (gated task).
- Testing impact: logic lane — asset baking (validation/dedup/failure), mock-kernel `bakedBody` rebuild, provider emission against fixture bundles, apply-pipeline chain ending in a baked body; OCC mesh materialization covered in the OCC feature spec lane; in-app smoke re-run on Taskariki recorded in change notes.

## Assumptions and Open Questions

- **Assumption:** faceted OCC bodies (sewn triangles) are acceptable v1 fidelity for baked geometry — visually correct, exportable, boolean-usable at mesh precision. Exact-geometry baking arrives with the STEP reader or `cadara-brep` assets.
- **Open question:** whether large tessellations need decimation/LOD at bake time; v1 stores what the bundle carries and measures.
- **Open question:** feature-tree UX for a baked body representing N collapsed features — v1 shows one `bakedBody` feature labeled with its source span; richer grouping is presentation work out of scope here.
