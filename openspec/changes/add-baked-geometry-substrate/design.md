# Design: Baked Geometry Substrate

## Context

- No `FeatureDefinition` variant consumes a geometry asset today; `bakeGeometry`/`registerGeometryAsset` are throwing stubs; `GeometryAssetFormat` already enumerates `baked-mesh`/`baked-occ`/`cadara-brep`/`step`/`stl`/`3mf`; `GeometryAssetStore` (memory + IndexedDB) exists.
- OCC recipe binds `STEPControl_Writer` only — no reader — so exact STEP baking requires a wasm rebuild (gated, task 3.4).
- Measured motivation: Taskariki imports with zero visible geometry; 35 baked features are invisible placeholders.

## Decision 1: `bakedBody` is a first-class feature, not a side-channel

Baked geometry enters through the normal feature pipeline (`CreateFeatureRequest` → history → rebuild), so undo/redo, suppression, persistence, exports, and downstream references all work for free. The feature's parameters are the asset reference + provenance; it deliberately exposes no pseudo-parametric geometry controls (honesty requirement).

## Decision 2: v1 materializes meshes as faceted kernel bodies

Bundle ground truth is tessellation; the OCC path sews triangles into a faceted shape with durable topology ids (consistent with the native payload contract). Accepted trade-off: mesh-precision booleans and heavy topology for dense meshes. Exact geometry arrives later via STEP reader or `cadara-brep` assets without changing the feature contract — the format field is the extension point.

## Decision 3: Assets are content-addressed

`bakeGeometry` deduplicates by content hash before storing, so re-imports and multi-studio bundles do not balloon storage; asset ids are derived from the hash (consistent with the existing embedded-binary registry pattern).

## Decision 4: Provider integration keeps the absence path

The Onshape provider bakes ground-truth tessellation only when the capability reports the format supported; the existing suppressed+diagnostic fallback remains for capability-absent platforms. The spec encodes both paths so honesty does not regress.

## Decision 5: Testing (per docs/testing.md)

Lane: **logic** for the contract variant, capability implementation, mock-kernel materialization, provider emission, and the apply-pipeline chain ending in a baked body; OCC materialization lands beside the existing OCC feature specs (same lane they use). In-app Taskariki smoke recorded in change notes. No new UI-lane tests unless feature-tree presentation needs bespoke logic.

## Risks

- Dense tessellations produce heavy faceted B-reps → measure during smoke; decimation is a named follow-up, not silently added.
- Faceted bodies as boolean targets may surprise users expecting exact geometry → feature label and diagnostics state the faceted provenance.
- STEP reader wasm-size cost unknown → gated assessment task before committing to the format.
