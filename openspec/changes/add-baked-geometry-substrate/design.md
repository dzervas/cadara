# Design: Baked Geometry Substrate

## Context

- No `FeatureDefinition` variant consumes a geometry asset today; `bakeGeometry`/`registerGeometryAsset` are throwing stubs; `GeometryAssetFormat` already enumerates `baked-mesh`/`baked-occ`/`cadara-brep`/`step`/`stl`/`3mf`; `GeometryAssetStore` (memory + IndexedDB) exists.
- OCC recipe binds `STEPControl_Writer` only — no reader — so exact STEP baking requires a wasm rebuild (gated, task 3.4).
- Measured motivation: Taskariki imports with zero visible geometry; 35 baked features are invisible placeholders.

## Decision 1: `bakedBody` is a first-class feature, not a side-channel

Baked geometry enters through the normal feature pipeline (`CreateFeatureRequest` → history → rebuild), so undo/redo, suppression, persistence, exports, and downstream references all work for free. The feature's parameters are the asset reference + provenance; it deliberately exposes no pseudo-parametric geometry controls (honesty requirement).

## Decision 2: v1 materializes meshes as faceted kernel bodies

Bundle ground truth is tessellation; the OCC path sews triangles into a faceted shape with durable topology ids (consistent with the native payload contract). Accepted trade-off: mesh-precision booleans and heavy topology for dense meshes. Exact geometry arrives later via STEP reader or `cadara-brep` assets without changing the feature contract — the format field is the extension point.

### 2026-07-12 deterministic component-partition amendment

`BakedMeshGeometryAssetData.components` carries ordered, contiguous triangle ranges keyed by the authoritative Onshape tessellation body. The provider writes one range directly from each source `bodies[]` entry; it never derives membership from coordinates, edge pairing, or spatial separation. OCC materializes exactly those declared components.

For compatibility, a v1 asset with no `components` is conservatively one declared component, never a soup to split. It must be one connected, closed, orientable two-manifold shell or materialization emits `baked-body-materializationFailed`. A declared source component with disconnected shells fails identically and requests one explicit source component per solid; this avoids inventing identity for compounds when the capture supplied no per-solid group. Edge pairing remains only a within-declared-component manifold/connectivity validation, never a source-body classifier.

## Decision 3: Assets are content-addressed

`bakeGeometry` deduplicates by content hash before storing, so re-imports and multi-studio bundles do not balloon storage; asset ids are derived from the hash (consistent with the existing embedded-binary registry pattern).

## Decision 3a: Kernel asset resolution is an injected seam (2026-07-10 amendment)

`CreateFeatureRequest` remains by-reference: it carries only the baked asset id/format, not geometry bytes, because feature requests are recorded in operation history and embedding blobs there would balloon history and persistence. Kernel adapters instead receive a narrow injected geometry-asset resolver (`resolveGeometryAsset(assetId) -> { bytes, format }`) at platform composition. The resolver reads the existing `GeometryAssetStore` (IndexedDB in the browser path), so reload rebuilds work by construction after `bakeGeometry` persists the bytes. Mock uses the resolver directly; OCC worker materialization uses a single worker request/response pair so the worker can ask the main thread for the transferable asset bytes. Resolver absence, asset absence, or invalid bytes produce structured diagnostics and no fabricated geometry.

## Decision 3b: Assets pre-resolve at async operation boundaries (2026-07-10 amendment)

OCC feature execution remains synchronous. Async worker/adapter operation boundaries scan the incoming request plus full authored feature history for `bakedBody` asset ids, resolve any uncached assets before rebuild, and then pass an immutable resolved-asset map (`assetId -> bytes/format`) into the execution context. `executeOccFeature` for `bakedBody` performs only synchronous map lookups; a map miss emits the structured asset-missing diagnostic and fails that feature. This avoids in-loop awaits during rebuild, keeps deterministic replay semantics, and ensures edits to unrelated early features still pre-resolve downstream baked bodies that will be re-executed. Worker-side asset bytes are immutable/content-addressed and cached by asset id; materialized faceted OCC shapes are also cached by asset id so rebuilds do not repeatedly sew large meshes.

## Decision 3c: The document is self-describing; no session registry (2026-07-11 amendment — Option B)

The original 3a/3b resolver seam took only an `assetId`, so the resolver needed a session-scoped, module-level registry (`bakedGeometryAssetRecords` in the import orchestrator) to learn the content hash before it could read the store. That registry was broken by construction: a reopened document starts with an empty registry, so `bakedBody` rebuild failed with `assetMissing` after reload, and production never threaded a shared store into imports. This amendment replaces that mechanism:

- **Definition-carried asset reference.** The `bakedBody` feature definition now carries the complete `BakedGeometryAssetReference` needed for resolution: `assetId`, `format`, content `hash`, and `byteLength`. That is sufficient to reconstruct the `GeometryAssetRecord` (`createGeometryAssetRecordFromReference`) without any session state. Requests/history entries remain by-reference (no blobs). `ImportCapabilities.bakeGeometry` returns that reference instead of a bare id.
- **Resolver takes the reference.** `GeometryAssetResolver.resolveGeometryAsset(reference)` (and the OCC worker request/response pair, `MockKernelAdapter`, and pre-resolution scan) now receive the full reference. Resolution is a pure `store.get(record)`; a store miss yields the existing structured `baked-body-assetMissing` diagnostic and never fabricated geometry.
- **Registry deleted.** `bakedGeometryAssetRecords` and `getBakedGeometryAssetRecord` are removed; no session-global asset state remains.
- **Single composition seam.** `createGeometryAssetComposition(store)` produces BOTH the import baking capability's store binding (writer) AND the kernel asset resolver (reader) from one `GeometryAssetStore`. The browser composition (`getBrowserGeometryAssetComposition`) memoizes one instance so `document-owner` (writer store) and the OCC kernel runtime (reader resolver) share it; tests obtain both ends from the same helper. This makes reload rebuilds work by construction: the IndexedDB-backed store persists the bytes, and the definition's reference resolves them on a fresh session.

## Decision 4: Provider integration keeps the absence path

The Onshape provider bakes ground-truth tessellation only when the capability reports the format supported; the existing suppressed+diagnostic fallback remains for capability-absent platforms. The spec encodes both paths so honesty does not regress.

## Decision 4a: Final-studio bakes are explicit body-output checkpoints (2026-07-12 amendment)

A `bakedBody` definition declares `replacement`: either `append` for ordinary independently imported geometry, or `replaceBodies` with exact durable body IDs. Kernels remove only the declared current bodies before adding the baked materialization; they retain prior feature/history records and their produced-target provenance. No geometry comparison, spatial matching, or hidden all-body deletion is permitted.

Onshape final-studio tessellation is ground truth, so its prepared action uses the import-only deferred form `replaceBodyOutputs(actionIndexes)`. The provider records every prior `createFeature` action in the same ordered import span; `ImportDeferredMaterializer` resolves their returned body outputs at apply time into the durable `replaceBodies` list. This uses the existing deferred-output seam rather than predicting IDs, scopes replacement to import-owned outputs, and leaves pre-existing/unrelated user bodies untouched. A baked checkpoint appears after those actions, so subsequent actions receive the baked body set.

## Decision 5: Testing (per docs/testing.md)

Lane: **logic** for the contract variant, capability implementation, mock-kernel materialization, provider emission, and the apply-pipeline chain ending in a baked body; OCC materialization lands beside the existing OCC feature specs (same lane they use). In-app Taskariki smoke recorded in change notes. No new UI-lane tests unless feature-tree presentation needs bespoke logic.

## Risks

- Dense tessellations produce heavy faceted B-reps → measure during smoke; decimation is a named follow-up, not silently added.
- Faceted bodies as boolean targets may surprise users expecting exact geometry → feature label and diagnostics state the faceted provenance.
- Worker-side resolved bytes and materialized shapes are cached by immutable asset id for rebuild performance; add a follow-up byte-budget/LRU policy before large multi-asset imports become common.
- STEP reader wasm-size cost unknown → gated assessment task before committing to the format.
