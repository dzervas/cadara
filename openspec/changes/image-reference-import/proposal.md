## Why

Users need to import images as sketching references — photographs of physical parts, scanned drawings, datasheets with dimensions. The workflow is: place an image on a sketch plane, draw calibration geometry over known features in the image (a ruler for scale, a vertical edge for orientation), add constraints to that geometry, and the sketch solver adjusts the image's position/scale/rotation/warp to match. The durable result is a sketch — the image bytes are stored as an embedded binary asset, and the sketch definition contains an image reference entity whose corner points control the image's transform. No raw image data lives in the sketch definition itself.

This is the first `ImportProvider` implementation on the new `import-provider-contract`.

## What Changes

- **New `imageReference` sketch entity kind** added to the `SketchEntityDefinition` union. The entity has 4 corner points (sketch points) that define a quad mapping the image onto the sketch plane. Corners are initially placed at positions computed from the image's pixel dimensions and a default scale. All 4 corners carry `fixPoint` constraints at their initial positions. The entity references an embedded binary asset by ID and records the original pixel dimensions. It is always `isConstruction: true` — image references never contribute to profile regions.
- **New `ImageImportProvider`** implementing `ImportProvider<ImageImportReview>`. Accepts common image formats (PNG, JPEG, WebP, BMP, TIFF). Review shows the image and lets the user pick a target plane. Prepare stores the image via `capabilities.assets.storeEmbeddedBinary()`, constructs an initial sketch definition with the image reference entity and its corner `fixPoint` constraints, and returns a `CommitSketchRequest`.
- **Sketch viewport rendering** extended to render image reference entities as textured quads mapped to their 4 corner points on the sketch plane. The rendering respects the current corner positions — as the solver moves corners in response to calibration constraints, the image follows.
- **Calibration workflow** uses existing sketch tools and constraints — no new constraint kinds needed. The user draws lines over known image features and constrains them (dimension for scale, vertical/horizontal for orientation, fix for position). Since the image's corners are sketch points with fixPoint constraints, the solver treats the entire system (image corners + calibration geometry) as one constraint graph. Relaxing or removing corner fixPoint constraints and adding calibration constraints lets the solver adjust the image transform.

### Warp vs. rigid behavior

The 4 corner points give 8 DOF. For rigid placement (translate + rotate + uniform scale), the user constrains enough to lock it down:
- One dimension constraint on a calibration line → sets scale (removes 1 DOF)
- One vertical/horizontal constraint → sets rotation (removes 1 DOF)
- One fixPoint on a corner → sets position (removes 2 DOF)
- Aspect-ratio or rectangular constraints on the quad → prevents shear (removes remaining DOF)

For deliberate perspective correction (un-warping a photograph taken at an angle), the user leaves corners less constrained and drags them to match known geometry in the image. The 4-point quad naturally supports affine and projective transforms.

## Capabilities

### New Capabilities
- `image-reference-sketch-entity`: Defines the `imageReference` sketch entity kind, its corner point model, initial placement from pixel dimensions, construction-only semantics, and viewport rendering as a textured quad.
- `image-import-provider`: Defines the `ImageImportProvider` implementing the `import-provider-contract`, covering file acceptance, review (plane selection), prepare (embedded binary storage + sketch creation), and the calibration workflow using existing sketch constraints.

### Modified Capabilities
- `sketch-expanded-entity-contract`: The entity definition union gains the `imageReference` variant.

## Impact

- `src/contracts/sketch/schema.ts`: `SketchEntityDefinition` union extended with `imageReference` kind.
- `src/contracts/sketch/runtime-schema.ts`: Zod schema extended for the new entity kind.
- New file under `src/domain/import/providers/` for the `ImageImportProvider`.
- Sketch viewport rendering (Three.js / React Three Fiber layer) extended to render textured quads for image reference entities.
- Sketch solver unaffected — the image reference is just construction geometry with points and fixPoint constraints. No solver changes needed.
- New embedded binary asset type registration in the asset capabilities implementation.
