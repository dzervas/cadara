## 1. Sketch Entity Contract — imageReference Kind

- [x] 1.1 Add `ImageReferenceSketchEntityDefinition` to the `SketchEntityDefinition` discriminated union in `src/contracts/sketch/schema.ts` — fields: `kind: 'imageReference'`, `cornerPointIds: [SketchPointId, SketchPointId, SketchPointId, SketchPointId]` (TL, TR, BR, BL winding), `embeddedBinaryId: string`, `pixelWidth: number`, `pixelHeight: number`. Always `isConstruction: true`.
- [x] 1.2 Add the `imageReference` Zod schema variant to `src/contracts/sketch/runtime-schema.ts` — validate 4 corner point IDs, non-empty asset ID, positive pixel dimensions.
- [x] 1.3 Add unit tests for the new schema variant in the existing sketch runtime-schema spec — valid entity, missing corners, zero dimensions.

## 2. Embedded Binary Asset Contract

- [x] 2.1 Define `EmbeddedBinaryAssetRecord` type alongside the geometry asset types (or in a new `src/contracts/modeling/embedded-binary-assets.ts`) — fields: `assetId: string`, `hash: string`, `byteLength: number`, `mediaType: string`, `fileName?: string`. This is the persisted record for non-geometry binary assets stored in `.cadara`.
- [x] 2.2 Add `embeddedBinaryAssets` field (array of `EmbeddedBinaryAssetRecord`) to `AuthoredModelDocument` in `src/contracts/modeling/authored-document.ts` — optional, defaults to empty array.
- [x] 2.3 Add Zod schema for `EmbeddedBinaryAssetRecord` and the new document field.

## 3. Image Import Provider

- [x] 3.1 Create `src/domain/import/providers/image-import-provider.ts` — implement `ImportProvider<ImageImportReview>` with `accepts()` matching PNG/JPEG/WebP/BMP/TIFF by extension and media type.
- [x] 3.2 Implement `review()` — decode image bytes to extract pixel width and height (use `createImageBitmap` or equivalent), return `ImportReviewEnvelope<ImageImportReview>` with pixel dimensions and source name. Return error diagnostic if decoding fails.
- [x] 3.3 Implement `prepare()` — call `capabilities.assets.storeEmbeddedBinary()` to store image bytes, compute initial corner positions from pixel dimensions (longest side → default extent, preserve aspect ratio), construct `SketchDefinition` with 4 points + 1 imageReference entity + 4 fixPoint constraints, return `ImportPreparedActions` with one `CommitSketchRequest` and an `ImportBinding` matching the source origin.
- [x] 3.4 Define `ImageImportReview` type — `{ pixelWidth: number, pixelHeight: number, sourceName: string }`.
- [x] 3.5 Define `ImageImportSelections` type — `{ plane: SketchPlaneDefinition, planeTarget: SketchPlaneSupportRef, planeKey: SketchPlaneKey | null }`.
- [x] 3.6 Add unit tests for the provider — accepts/rejects correct file types, review extracts dimensions, prepare produces valid sketch definition with correct point count and constraint count.

## 4. Provider Registration

- [x] 4.1 Register `ImageImportProvider` in the import provider registry (wherever providers are collected for the orchestrator's `matchProviders()`).

## 5. Sketch Viewport Rendering — Image Texture

- [x] 5.1 In the sketch entity rendering layer (React Three Fiber), add a case for `imageReference` entities — load the embedded binary as a Three.js texture, render a `PlaneGeometry` (two triangles) mapped to the 4 corner point positions in world space via the sketch plane frame.
- [x] 5.2 Set the image quad render order behind all other sketch geometry (lower z-order or render-order priority).
- [x] 5.3 Handle missing/loading texture state — render quad outline without texture when the asset is unavailable or still loading.
- [x] 5.4 UV mapping: TL corner → (0,1), TR → (1,1), BR → (1,0), BL → (0,0) — consistent with the corner winding order.

## 6. Verification

- [x] 6.1 Run `bun run build` — confirm zero compile errors.
- [x] 6.2 Run `bun run lint` — confirm zero lint errors.
- [x] 6.3 Run `bun run test` — confirm all tests pass including new image import provider tests.
