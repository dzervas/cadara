## 1. Contract & Schema Changes

- [x] 1.1 Add `unificationLinearTolerance` and `unificationAngularTolerance` optional fields to `MeshReconstructionSettings` in `src/domain/modeling/baked-mesh-geometry.ts`
- [x] 1.2 Add `unificationDiagnostics` type (preFaceCount, postFaceCount, mergedSurfaceTypes) and add it as an optional field to `MeshReconstructionProvenance` in `src/contracts/modeling/geometry-assets.ts`
- [x] 1.3 Update the runtime zod schema in `src/contracts/modeling/geometry-assets.runtime-schema.ts` to match the new provenance fields

## 2. Kernel Unification Pass

- [x] 2.1 Extract a reusable `unifyMeshSolidFaces` function in `src/domain/modeling/occ/features.ts` that applies `ShapeUpgrade_UnifySameDomain` with configurable tolerances (default 0.01/0.01) and returns the unified solid plus diagnostics (pre/post face count, surface type summary)
- [x] 2.2 Call `unifyMeshSolidFaces` in `readBakedMeshImportSolid` after `BRepBuilderAPI_MakeSolid` succeeds, passing tolerances from reconstruction settings
- [x] 2.3 Keep `seedNaming` enabled for recovered analytical mesh imports, but preserve lightweight non-seeded topology IDs for faceted fallback imports
- [x] 2.4 Add a conservative analytic cylinder rebuild path before STL shell restore for simple capped cylinder meshes
- [x] 2.5 Bound same-domain unification so large or explicitly faceted fallback meshes commit without an expensive triangle-scale merge pass
- [x] 2.6 Skip synchronous worker rebuild validation for faceted fallback commits so the progress dialog can close promptly

## 3. Provenance Recording

- [x] 3.1 Thread unification diagnostics from the kernel pass back through `executeMeshImportFeature` and attach to the feature result or provenance metadata

## 4. Tests

- [x] 4.1 Add a unit test in `opencascade-kernel-adapter.spec.ts` that imports a simple box STL (6 faces expected after unification) and asserts the post-unification face count is 6
- [x] 4.2 Add a unit test that imports a cylinder STL and asserts the post-unification face count includes cylindrical and planar faces
- [x] 4.3 Add a unit test that verifies faceted fallback mesh imports now have `seedNaming: true` and produce durable face IDs
- [x] 4.4 Run `bun run test`, `bun run lint`, and `bun run build` to verify no regressions
