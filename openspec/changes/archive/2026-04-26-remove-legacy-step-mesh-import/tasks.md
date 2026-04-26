## 1. Contract Layer — Feature Kinds and Schema Versions

- [x] 1.1 Remove `stepImport` and `meshImport` variants from `FeatureKind` type union in `src/contracts/modeling/schema.ts`
- [x] 1.2 Remove `stepImport` and `meshImport` from `AuthoredFeatureKind` exclusion in `src/contracts/modeling/schema.ts`
- [x] 1.3 Remove `stepImport` and `meshImport` cases from `FeatureDefinition` discriminated union in `src/contracts/modeling/schema.ts`
- [x] 1.4 Remove `StepImportFeatureParameters` and `MeshImportFeatureParameters` imports and re-exports from `src/contracts/modeling/schema.ts`
- [x] 1.5 Remove `StepImportDiagnosticDetail` and `MeshImportDiagnosticDetail` from `ModelingDiagnosticDetail` union in `src/contracts/modeling/schema.ts`
- [x] 1.6 Remove `StepImportFeatureSchemaVersion` and `MeshImportFeatureSchemaVersion` from `src/contracts/shared/versioning.ts` (type, constant, and union membership)
- [x] 1.7 Remove `stepImportDefinitionSchema` and `meshImportDefinitionSchema` from `src/contracts/modeling/runtime-schema.ts` (schemas and feature definition union)
- [x] 1.8 Remove step/mesh import related schemas (stepImportAssetIdSchema, stepImportSourceFileSchema, stepImportSelectedSolidSchema, stepImportParametersSchema, meshImportResolvedSettingsSchema) from `src/contracts/modeling/runtime-schema.ts`

## 2. Contract Layer — Adapter Interface

- [x] 2.1 Remove `prepareStepImportReview()`, `bakeStepImportGeometry()`, `getStepImportMaterializationStatus()`, `subscribeToStepImportMaterializationStatus()` from `ModelingKernelAdapter` in `src/contracts/modeling/adapter.ts`
- [x] 2.2 Remove `StepImportBakeGeometryResult` type from `src/contracts/modeling/adapter.ts`
- [x] 2.3 Remove step-import type imports from `src/contracts/modeling/adapter.ts`

## 3. Contract Layer — Delete Dedicated Files

- [x] 3.1 Delete `src/contracts/modeling/step-import.ts`
- [x] 3.2 Delete `src/contracts/modeling/step-import.spec.ts`
- [x] 3.3 Delete `src/contracts/modeling/mesh-import.ts`
- [x] 3.4 Delete `src/contracts/modeling/mesh-reconstruction.ts`
- [x] 3.5 Delete `src/contracts/modeling/mesh-reconstruction.runtime-schema.ts`
- [x] 3.6 Remove step-import and mesh-reconstruction exports from `src/contracts/modeling/index.ts`

## 4. Contract Layer — Geometry Asset Provenance

- [x] 4.1 Remove `reconstruction?: MeshReconstructionProvenance` field and its import from `GeometryAssetProvenance` in `src/contracts/modeling/geometry-assets.ts`
- [x] 4.2 Remove `createMeshReconstructionProvenanceSchema` import and `reconstruction` field from `src/contracts/modeling/geometry-assets.runtime-schema.ts`

## 5. OCC Layer — Worker Protocol and Client

- [x] 5.1 Remove `prepareStepImportReview` and `bakeStepImportGeometry` request types from `src/domain/modeling/occ/worker-protocol.ts`
- [x] 5.2 Remove `stepImportReviewPrepared` and `stepImportGeometryBaked` response types from `src/domain/modeling/occ/worker-protocol.ts`
- [x] 5.3 Remove step import methods from `src/domain/modeling/occ/worker-client.ts`
- [x] 5.4 Remove step import message handlers from `src/domain/modeling/occ/worker.ts`

## 6. OCC Layer — Feature Execution and Snapshot

- [x] 6.1 Remove `executeStepImportFeature()` and all STEP import helper functions from `src/domain/modeling/occ/features.ts`
- [x] 6.2 Remove `executeMeshImportFeature()`, mesh reconstruction helpers, `readBakedMeshImportSolid()`, mesh import error code functions, and related imports from `src/domain/modeling/occ/features.ts`
- [x] 6.3 Remove `stepImport` and `meshImport` cases from feature execution dispatch in `src/domain/modeling/occ/features.ts`
- [x] 6.4 Remove `stepImport` and `meshImport` cases from `src/domain/modeling/occ/snapshot.ts` (snapshot building and render record)
- [x] 6.5 Remove `buildFacetedMeshImportRenderRecord()` from `src/domain/modeling/occ/snapshot.ts`
- [x] 6.6 Remove `stepImportInstrumentation` from `OccFeatureExecutionContext` in `src/domain/modeling/occ/authoring-state.ts`

## 7. Domain Layer — Kernel Adapter

- [x] 7.1 Remove all STEP import materialization state, deferred import tracking, status emission, and subscription logic from `src/domain/modeling/opencascade-kernel-adapter.ts`
- [x] 7.2 Remove `prepareStepImportReview()` and `bakeStepImportGeometry()` implementations from `src/domain/modeling/opencascade-kernel-adapter.ts`
- [x] 7.3 Remove workspace snapshot augmentation with step import presentation from `src/domain/modeling/opencascade-kernel-adapter.ts`
- [x] 7.4 Remove `stepImportInstrumentation` from `createBaseAuthoringState()` in `src/domain/modeling/opencascade-kernel-adapter.ts`
- [x] 7.5 Remove all step/mesh import related imports from `src/domain/modeling/opencascade-kernel-adapter.ts`

## 8. Domain Layer — Modeling Service

- [x] 8.1 Remove `prepareStepImportReview`, `commitPreparedStepImport`, `getStepImportMaterializationStatus`, `subscribeToStepImportMaterializationStatus` from modeling service interface and implementation in `src/domain/modeling/modeling-service.ts`
- [x] 8.2 Remove `normalizeStepImportFeatureParameters()` and `normalizeMeshImportFeatureParameters()` from `src/domain/modeling/modeling-service.ts`
- [x] 8.3 Remove `stepImport` and `meshImport` cases from feature normalization dispatch in `src/domain/modeling/modeling-service.ts`
- [x] 8.4 Remove all STEP/mesh import allocation, label, asset, and document creation helpers from `src/domain/modeling/modeling-service.ts`
- [x] 8.5 Remove all step/mesh import related type imports from `src/domain/modeling/modeling-service.ts`

## 9. Domain Layer — Delete Dedicated Files

- [x] 9.1 Delete `src/domain/modeling/step-import-materialization.ts`
- [x] 9.2 Delete `src/domain/modeling/baked-mesh-geometry.ts`
- [x] 9.3 Delete `src/domain/modeling/baked-mesh-geometry.spec.ts`
- [x] 9.4 Delete `src/domain/modeling/mesh-parser.ts`
- [x] 9.5 Delete `src/domain/modeling/mesh-import-review.worker.ts`
- [x] 9.6 Delete `src/domain/modeling/mesh-import-review-worker-protocol.ts`

## 10. Domain Layer — Supporting Files

- [x] 10.1 Remove `StepImportFeatureParameterDraft` and `StepImportFeatureEditSessionState` from `src/domain/feature-authoring/definition.ts`
- [x] 10.2 Remove step/mesh exemptions from `src/domain/modeling/feature-diagnostic-mapping.ts`
- [x] 10.3 Remove `stepImport` and `meshImport` cases from `src/domain/modeling/mock-kernel-adapter.ts`
- [x] 10.4 Remove `stepImport` and `meshImport` from capability lists in `src/domain/modeling/opencascade-kernel-seed.ts`

## 11. App Layer — Workbench UI

- [x] 11.1 Remove `stepImportFlow`, `stepImportProgress`, `stepImportMaterializationStatus` state and all STEP import event handlers from `src/app/cad-workbench.tsx`
- [x] 11.2 Remove `meshImportFlow`, `meshImportProgress`, mesh worker refs, and all mesh import event handlers from `src/app/cad-workbench.tsx`
- [x] 11.3 Remove STEP and mesh import review dialog JSX and data attributes from `src/app/cad-workbench.tsx`
- [x] 11.4 Remove STEP/mesh import type imports and helper function imports from `src/app/cad-workbench.tsx`

## 12. Test Files

- [x] 12.1 Delete `src/app/cad-workbench-step-import-review.spec.ts`
- [x] 12.2 Delete `src/app/cad-workbench-mesh-import.spec.ts`
- [x] 12.3 Clean up step/mesh import test data from `src/domain/modeling/modeling-service-document-repository.spec.ts`
- [x] 12.4 Clean up step/mesh import tests from `src/domain/modeling/opencascade-kernel-adapter.spec.ts`
- [x] 12.5 Clean up `feature_stepImport-1` test fixture from `src/domain/workspace/viewport-projection.spec.ts` (replace with a different feature kind)
- [x] 12.6 Clean up step import reference from `src/app/cad-workbench-part-import-toolbar.spec.ts`
- [x] 12.7 Clean up step/mesh import document schema tests from `src/contracts/modeling/authored-document.runtime-schema.spec.ts`

## 13. Verification

- [x] 13.1 Run `bun run build` — confirm zero compile errors
- [x] 13.2 Run `bun run lint` — confirm zero lint errors
- [x] 13.3 Run `bun run test` — confirm all remaining tests pass
- [x] 13.4 Grep codebase for `stepImport`, `meshImport`, `step-import`, `mesh-import`, `mesh-reconstruction`, `StepImport`, `MeshImport`, `MeshReconstruction` — confirm zero matches outside of openspec archives and the new import-provider-contract
