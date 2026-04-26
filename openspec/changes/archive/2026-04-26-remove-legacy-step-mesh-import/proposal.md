## Why

The legacy STEP and mesh import implementations are tightly coupled to the adapter, worker protocol, UI workbench, and snapshot pipeline through special-case methods, dedicated feature kinds, materialization subscriptions, and format-specific state machines. The new `import-provider-contract` defines a clean provider-based pipeline that replaces all of this. The legacy code must be fully removed — not deprecated, not feature-flagged — so that fresh provider implementations start from a clean slate with no dead code, stale switch cases, or ghost types influencing the codebase. The functionality is behind a feature flag so no user-facing regression occurs.

## What Changes

- **BREAKING**: Remove `stepImport` and `meshImport` variants from the `FeatureDefinition` union, `FeatureKind`, and `AuthoredFeatureKind` in `src/contracts/modeling/schema.ts`. Remove their schema versions from `src/contracts/shared/versioning.ts` and runtime schemas from `src/contracts/modeling/runtime-schema.ts`.
- **BREAKING**: Remove `prepareStepImportReview()`, `bakeStepImportGeometry()`, `getStepImportMaterializationStatus()`, and `subscribeToStepImportMaterializationStatus()` from the `ModelingKernelAdapter` interface.
- **BREAKING**: Remove `StepImportBakeGeometryResult` type from `src/contracts/modeling/adapter.ts`.
- Delete contract files: `src/contracts/modeling/step-import.ts`, `src/contracts/modeling/mesh-import.ts`, `src/contracts/modeling/mesh-reconstruction.ts`, `src/contracts/modeling/mesh-reconstruction.runtime-schema.ts`.
- Delete domain files: `src/domain/modeling/step-import-materialization.ts`, `src/domain/modeling/baked-mesh-geometry.ts`, `src/domain/modeling/mesh-parser.ts`, `src/domain/modeling/mesh-import-review.worker.ts`, `src/domain/modeling/mesh-import-review-worker-protocol.ts`.
- Remove all STEP/mesh import logic from: `src/domain/modeling/opencascade-kernel-adapter.ts` (materialization state, deferred import tracking, snapshot augmentation), `src/domain/modeling/occ/features.ts` (executeStepImportFeature, executeMeshImportFeature, mesh reconstruction helpers), `src/domain/modeling/occ/worker-protocol.ts` (step import request/response types), `src/domain/modeling/occ/worker-client.ts` (step import worker methods), `src/domain/modeling/occ/worker.ts` (step import message handlers), `src/domain/modeling/occ/snapshot.ts` (step/mesh snapshot cases, faceted mesh render), `src/domain/modeling/occ/authoring-state.ts` (stepImportInstrumentation).
- Remove all STEP/mesh import logic from: `src/domain/modeling/modeling-service.ts` (prepareStepImportReview, commitPreparedStepImport, normalization functions, allocation helpers, mesh import document creation).
- Remove STEP/mesh import UI from `src/app/cad-workbench.tsx`: state machines (`stepImportFlow`, `meshImportFlow`), progress tracking, materialization subscription, file reading, review dialogs, worker lifecycle.
- Remove `StepImportFeatureParameterDraft` and related types from `src/domain/feature-authoring/definition.ts`.
- Clean up `src/domain/modeling/feature-diagnostic-mapping.ts` (remove step/mesh exemptions).
- Clean up `src/domain/modeling/mock-kernel-adapter.ts` (remove step/mesh feature cases).
- Clean up `src/domain/modeling/opencascade-kernel-seed.ts` (remove step/mesh from capability lists).
- Remove `MeshReconstructionProvenance` import and `reconstruction` field from `GeometryAssetProvenance` in `src/contracts/modeling/geometry-assets.ts`.
- Delete test files: `src/contracts/modeling/step-import.spec.ts`, `src/app/cad-workbench-step-import-review.spec.ts`, `src/app/cad-workbench-mesh-import.spec.ts`, `src/domain/modeling/baked-mesh-geometry.spec.ts`.
- Clean up references in: `src/domain/modeling/modeling-service-document-repository.spec.ts`, `src/domain/modeling/opencascade-kernel-adapter.spec.ts`, `src/domain/workspace/viewport-projection.spec.ts`, `src/app/cad-workbench-part-import-toolbar.spec.ts`, `src/contracts/modeling/authored-document.runtime-schema.spec.ts`.

## Capabilities

### New Capabilities
_(none)_

### Modified Capabilities
- `step-exact-solid-import`: All requirements removed — capability fully deleted.
- `mesh-baked-geometry-import`: All requirements removed — capability fully deleted.
- `mesh-face-unification`: All requirements removed — capability fully deleted.
- `mesh-reconstruction-fallbacks`: All requirements removed — capability fully deleted.
- `geometry-asset-substrate`: Requirements referencing STEP source retention, mesh baked assets, mesh reconstruction quality metadata, and multi-file STEP asset provenance removed. Core asset, validation, ZIP packaging, and derived-data transience requirements retained.
- `durable-modeling-contract`: Requirements for STEP import and mesh import feature kinds removed.
- `feature-authoring-definition`: Requirements for STEP import feature authoring removed.
- `workbench-document-file-menu`: Requirements for STEP file import flow, STL/3MF import flow, and multi-file STEP selection removed.

## Impact

- ~42 files modified or deleted across contracts, domain, OCC, app, and test layers.
- ~1,060 lines of dedicated import code deleted outright.
- Substantial removals from `modeling-service.ts` (~500 lines), `opencascade-kernel-adapter.ts` (~400 lines), `occ/features.ts` (~500 lines), `cad-workbench.tsx` (~600 lines).
- `FeatureDefinition` union shrinks by 2 variants; all downstream switch/case/if chains that matched on them are removed.
- 4 adapter interface methods removed.
- 2 OCC worker request/response types removed.
- 8 openspec specs fully removed or have major requirement deletions.
- No new code is introduced. This change is pure removal.
