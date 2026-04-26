## Context

The `import-provider-contract` change established a clean provider-based import pipeline. The legacy STEP and mesh import code predates this contract and is wired into the codebase through special-case adapter methods, dedicated feature kinds in the `FeatureDefinition` union, format-specific materialization subscriptions, worker protocol extensions, and UI state machines in the workbench. This code must be fully removed before fresh provider implementations can be built on the new contract, otherwise contributors will inherit dead switch cases, ghost types, and stale patterns that conflict with or shadow the provider pipeline.

The functionality is behind a feature flag. No backwards compatibility is required. No migration path is needed.

## Goals / Non-Goals

**Goals:**
- Remove every trace of the legacy STEP and mesh import implementations: contract types, domain logic, OCC worker extensions, adapter methods, UI state machines, test files, and spec requirements.
- Leave the codebase in a compiling, lint-clean, test-passing state with no dead references.
- Ensure no leftover switch cases, type imports, feature kind variants, or diagnostic codes remain that would interfere with fresh provider-based implementations.

**Non-Goals:**
- Implementing replacement STEP or mesh import providers on the new contract — that is a separate change.
- Modifying the `import-provider-contract` types or `ImportCapabilities` interfaces.
- Changing the geometry export pipeline (STL/STEP/3MF export is unrelated to import).
- Removing or modifying the `GeometryAssetManifest` infrastructure — only the STEP/mesh-specific provenance fields and reconstruction metadata are removed.
- Touching any OCC worker infrastructure beyond removing the STEP-specific request/response types and handlers.

## Decisions

### 1. Delete files outright rather than gutting them

**Decision:** Files that exist solely for STEP/mesh import are deleted entirely, not emptied or left as stubs.

**Rationale:** Empty or stub files create confusion for contributors and accumulate as noise. The new provider implementations will create their own files under `src/contracts/import/` and provider-specific directories.

**Files deleted:**
- `src/contracts/modeling/step-import.ts` and `.spec.ts`
- `src/contracts/modeling/mesh-import.ts`
- `src/contracts/modeling/mesh-reconstruction.ts` and `.runtime-schema.ts`
- `src/domain/modeling/step-import-materialization.ts`
- `src/domain/modeling/baked-mesh-geometry.ts` and `.spec.ts`
- `src/domain/modeling/mesh-parser.ts`
- `src/domain/modeling/mesh-import-review.worker.ts`
- `src/domain/modeling/mesh-import-review-worker-protocol.ts`
- `src/app/cad-workbench-step-import-review.spec.ts`
- `src/app/cad-workbench-mesh-import.spec.ts`

### 2. Remove feature kinds from the union, don't deprecate

**Decision:** `stepImport` and `meshImport` are removed from `FeatureKind`, `FeatureDefinition`, and all runtime schemas. No `@deprecated` tag, no tombstone variant.

**Rationale:** No backwards compatibility needed. Existing documents with these feature kinds will fail to parse against the updated schema, which is the intended behavior — those documents are test fixtures that will be updated or removed.

### 3. Remove adapter methods, don't make them throw

**Decision:** The 4 STEP-specific methods are removed from the `ModelingKernelAdapter` interface entirely, not converted to `throw new Error('removed')` stubs.

**Rationale:** Compile-time breakage is better than runtime breakage. Any code that still references these methods will fail to compile, making leftover references easy to find and clean up.

### 4. Remove `reconstruction` from `GeometryAssetProvenance`

**Decision:** The `reconstruction?: MeshReconstructionProvenance` field is removed from `GeometryAssetProvenance`. The `MeshReconstructionProvenance` type is deleted with its source file.

**Rationale:** This field only existed for mesh import baked geometry. The new provider contract stores import metadata through `importBinding` on provenance instead. No other code path produces reconstruction provenance.

### 5. Removal order to maintain compilability

**Decision:** Remove in dependency order — contracts first (types), then domain (logic), then app (UI), then tests. Within each layer, remove leaf dependencies before their consumers.

**Rationale:** Working in dependency order means each step compiles. If something doesn't compile after a removal, it means we missed a reference — which is exactly the signal we want.

Concrete order:
1. Remove feature kind variants and schema versions from contracts
2. Remove adapter interface methods
3. Delete dedicated contract files (step-import, mesh-import, mesh-reconstruction)
4. Remove STEP/mesh logic from OCC features, worker, snapshot, authoring state
5. Remove from opencascade-kernel-adapter
6. Remove from modeling-service
7. Delete dedicated domain files (materialization, baked-mesh, mesh-parser, worker)
8. Remove from feature-authoring definitions
9. Remove from mock-kernel-adapter, kernel-seed, diagnostic-mapping
10. Remove from cad-workbench UI
11. Delete dedicated test files, clean up remaining test references
12. Remove STEP/mesh-specific geometry asset provenance fields
13. Verify build, lint, test

## Risks / Trade-offs

**[Large diff across many files]** → ~42 files touched, ~3,000+ lines removed. Mitigation: pure removal with no new code means each deletion is independently verifiable — if it compiles, it's correct.

**[Test fixtures reference step/mesh features]** → Some spec files use step/mesh import as test data (e.g. `feature_stepImport-1` in viewport projection tests). Mitigation: replace with a different feature kind in those fixtures rather than deleting the entire test.

**[Geometry asset provenance narrowing]** → Removing `reconstruction` from `GeometryAssetProvenance` and STEP-specific source fields changes the persisted schema. Mitigation: no backwards compatibility required, and the `importBinding` field from the provider contract is already the replacement.
