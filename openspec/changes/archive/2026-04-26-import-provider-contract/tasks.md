## 1. Core Contract Types

- [x] 1.1 Create `src/contracts/import/source.ts` — `ImportSource` union (`localFile | url | cloudObject`), `ResolvedImportSource` with bytes/fingerprint/origin. Comment: orchestrator resolves transport before providers see the source.
- [x] 1.2 Create `src/contracts/import/capabilities.ts` — `ImportCapabilities` interface with `modeling`, `sketch`, `assets` sub-objects. All non-nullable. Each sub-interface has method stubs with doc comments describing purpose (geometry baking, mesh-to-BRep reconstruction, vector-to-sketch conversion, asset registration, embedded binary storage). No implementations.
- [x] 1.3 Create `src/contracts/import/provider.ts` — `ImportProvider<TReview>` interface with `id`, `label`, `accepts()`, `review()`, `prepare()`. Comment: providers are stateless data transformers; review result is passed back into prepare by the orchestrator.
- [x] 1.4 Create `src/contracts/import/actions.ts` — `ImportPreparedActions` with optional arrays of `CreateFeatureRequest`, `CommitSketchRequest`, `AddDocumentVariableRequest`, plus optional `ImportBinding` and diagnostics. Comment: the orchestrator applies these through existing adapter methods.
- [x] 1.5 Create `src/contracts/import/binding.ts` — `ImportBinding` discriminated union (`localFile | url | cloudObject`) with fingerprint and refresh policy. Comment: stored on entity provenance, not in a separate manifest.
- [x] 1.6 Create `src/contracts/import/diagnostics.ts` — `ImportDiagnostic` with severity and message. Comment: returned from review and prepare; orchestrator surfaces these to the user.
- [x] 1.7 Create `src/contracts/import/review.ts` — `ImportReviewEnvelope<T>` with `providerReview: T`, `proposedActionKinds`, and diagnostics. Comment: generic over provider-specific review payload.
- [x] 1.8 Create `src/contracts/import/index.ts` — barrel export for all import contract types.

## 2. Provenance Extension

- [x] 2.1 Extend `GeometryAssetProvenance` in `src/contracts/modeling/geometry-assets.ts` with an optional `importBinding?: ImportBinding` field. Comment: carries external source metadata for refresh/relink without a separate manifest.

## 3. Orchestrator Contract

- [x] 3.1 Create `src/contracts/import/orchestrator.ts` — `ImportOrchestrator` interface with methods: `resolveSource(source: ImportSource): Promise<ResolvedImportSource>`, `matchProviders(source: ResolvedImportSource): ImportProvider[]`, `executeImport(provider, source, review, selections): Promise<ImportResult>`. Comment: resolves transport, runs provider pipeline, applies prepared actions through adapter. No implementation — contract only.
- [x] 3.2 Create `src/contracts/import/result.ts` — `ImportResult` type returned by the orchestrator after applying prepared actions, containing created entity IDs, applied binding metadata, and any adapter diagnostics. Comment: the orchestrator collects adapter responses and surfaces them as a single import result.

## 4. Binding Store Contract

- [x] 4.1 Create `src/contracts/import/binding-store.ts` — `ImportBindingStore` interface with `getLocalFileHandle(entityId)`, `setLocalFileHandle(entityId, handle)`, `clearLocalFileHandle(entityId)`. Comment: workspace-level store for browser-local capabilities; lives outside document JSON, consistent with local-file-system-document-sync design.

## 5. Versioning and Schema

- [x] 5.1 Add `ImportContractSchemaVersion` to `src/contracts/shared/versioning.ts` — version string for the import contract types (e.g. `'import-contract/v1alpha1'`).

## 6. Validation

- [x] 6.1 Add Zod schemas for `ImportSource`, `ResolvedImportSource`, `ImportBinding`, `ImportDiagnostic`, and `ImportPreparedActions` in `src/contracts/import/validation.ts`. Comment: used at transport/persistence boundaries per the existing runtime-contract-validation pattern.
- [x] 6.2 Run `bun run test`, `bun run lint`, `bun run build` to verify no regressions from the new contract files.
