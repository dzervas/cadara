## Why

The current STEP and mesh import code is tightly coupled to specific file formats with no shared contract, making it impossible for contributors to add new import types (DXF, SVG, images, spreadsheets, SolidWorks, Fusion 360) without duplicating orchestration, review flow, and persistence plumbing. We need a single provider contract that answers three questions for every import: what did we extract, what do we persist in `.cadara`, and can we refresh it later.

## What Changes

- **New unified `ImportProvider` interface** that every file-format importer implements: `accepts` (file matching), `review` (non-mutating analysis for user preview), and `prepare` (turn user selections into requests the existing adapter already understands).
- **New `ImportCapabilities` object** injected into providers, giving access to platform operations (geometry baking, mesh-to-BRep reconstruction, vector-to-sketch conversion, asset registration) without providers importing kernel internals. The capabilities surface grows over time as the platform adds operations.
- **New `ImportPreparedActions` return type** that produces `CreateFeatureRequest`, `CommitSketchRequest`, and `AddDocumentVariableRequest` payloads — funneling all mutations through the existing `ModelingKernelAdapter` so revision tracking, operation history, and undo/redo work automatically.
- **New `ImportBinding` type and `ImportedAssetProvenance` extension** to track external source metadata (local file, URL, cloud object) on the entities that were created, enabling refresh/relink without a separate manifest.
- **New `ImportOrchestrator`** that resolves source transport (fetch URL, read file handle, call cloud API), runs the provider pipeline, and applies prepared actions through the adapter.
- **New `ImportBindingStore`** (workspace-level, outside the document) for browser-local capabilities like `FileSystemFileHandle` that cannot leak into portable document JSON.
- **BREAKING**: Existing `stepImport` and `meshImport` feature kinds, `prepareStepImportReview`, `bakeStepImportGeometry`, and related adapter methods will be replaced by providers implementing the new contract. The feature definitions will be redesigned to work through the provider system.

## Capabilities

### New Capabilities
- `import-provider-contract`: Defines the `ImportProvider` interface, `ImportCapabilities`, `ImportPreparedActions`, `ImportBinding`, source resolution, and the orchestrator that wires providers to the existing adapter mutation path.
- `import-binding-store`: Workspace-level store for non-portable binding capabilities (e.g. `FileSystemFileHandle`) kept outside document JSON, consistent with local file system document sync design.

### Modified Capabilities
- `geometry-asset-substrate`: Asset provenance extended with optional `ImportBinding` metadata for refresh/relink tracking.

## Impact

- `src/contracts/modeling/adapter.ts`: STEP/mesh-specific import methods removed; replaced by generic provider pipeline feeding existing `createFeature`/`commitSketch`/`addDocumentVariable`.
- `src/contracts/modeling/schema.ts`: `stepImport` and `meshImport` feature definition kinds redesigned as provider-produced feature definitions.
- `src/contracts/modeling/step-import.ts`, `mesh-import.ts`: Replaced by provider implementations outside the core contract.
- `src/contracts/modeling/geometry-assets.ts`: `GeometryAssetProvenance` extended with binding metadata.
- New files under `src/contracts/import/` for the provider contract, capabilities interface, prepared actions, binding types, and orchestrator contract.
- Existing STEP/mesh E2E tests will need updating to use the new provider flow.
