## Context

The application currently has two hard-coded import paths: STEP exact solids and mesh baked geometry. Both are wired directly into the `ModelingKernelAdapter` as special-case methods (`prepareStepImportReview`, `bakeStepImportGeometry`) with format-specific feature kinds (`stepImport`, `meshImport`) in the closed `FeatureDefinition` union. This makes adding any new import type (DXF, SVG, images, spreadsheets, SolidWorks, Fusion 360) require changes to the core adapter contract.

The existing import code is being rewritten. Rather than fixing it in place, this change introduces a provider-based contract that decouples file-format knowledge from the core modeling pipeline.

Key existing patterns this design builds on:
- `ModelingKernelAdapter` request/response mutations with revision-based concurrency
- `GeometryAssetManifest` with content-addressed immutable assets and provenance tracking
- `ModelingOperationHistory` for undo/redo replay
- `local-file-system-document-sync` for browser `FileSystemFileHandle` management outside the document
- The existing `prepareStepImportReview` → `createFeature` two-phase pattern (review then commit)

## Goals / Non-Goals

**Goals:**
- A single `ImportProvider` interface that contributors implement to add new file format support
- Providers are stateless data transformers: they receive bytes and return structured data the platform applies
- All import mutations flow through existing adapter methods (`createFeature`, `commitSketch`, `addDocumentVariable`) — no parallel mutation path
- An `ImportCapabilities` dependency-injection boundary gives providers access to platform operations (geometry baking, mesh reconstruction, vector-to-sketch conversion, asset registration) without importing kernel internals
- External source binding metadata (local file, URL, cloud object) persists on the entities that were created, not in a separate manifest
- Source transport resolution (fetching URLs, reading file handles, calling cloud APIs) is the orchestrator's job, not the provider's
- The contract supports refresh/relink by re-running the same provider with updated source data

**Non-Goals:**
- Implementing any specific provider (STEP, mesh, DXF, etc.) — this change is contract-only
- Implementing the `ImportCapabilities` methods — they are interface-only with comments describing purpose
- Auto-refresh or live-sync with external sources — only the contract hooks for manual refresh
- Cloud object binding implementation — only the type slot in `ImportBinding`
- Multi-document or assembly-level import orchestration
- UI for the import review flow — only the data contract the UI will consume

## Decisions

### 1. Providers return prepared requests, not effects

**Decision:** `ImportProvider.prepare()` returns `ImportPreparedActions` containing `CreateFeatureRequest[]`, `CommitSketchRequest[]`, and `AddDocumentVariableRequest[]` — the same request types the adapter already accepts.

**Alternative considered:** An `ImportEffect` discriminated union with `replaceDocument`, `createFeatures`, `createSketches`, `upsertVariables` that the orchestrator interprets and applies. This creates a parallel mutation vocabulary that must stay in sync with the adapter contract. Every new adapter mutation type would need a corresponding effect variant.

**Rationale:** Using the existing request types means revision-based concurrency, operation history, and undo/redo work automatically. No new mutation path to maintain.

### 2. Capabilities are injected, not imported

**Decision:** Providers receive an `ImportCapabilities` object with `modeling`, `sketch`, and `assets` sub-objects. All fields are non-nullable — if the platform runs, these exist.

**Alternative considered:** Providers import helper functions directly from kernel modules. This creates direct coupling between providers and kernel internals, making it impossible to swap implementations or test providers in isolation.

**Alternative considered:** Nullable capability groups with a `requiredCapabilities` declaration on providers. Rejected because the capabilities represent the kernel itself — if there's no kernel, there's no app. The null checks would be dead code.

**Rationale:** DI boundary keeps providers testable and decoupled. Non-nullable because the capabilities are the platform, not optional features.

### 3. No separate imported-resource manifest

**Decision:** Import binding/provenance metadata is stored on the entities that were created — extended `GeometryAssetProvenance` for geometry-backed imports, and a new optional `importBinding` field on authored feature/sketch/variable records.

**Alternative considered:** A dedicated `ImportedResourceManifest` parallel to `GeometryAssetManifest`. This creates two sources of truth for what was imported. Deleting a feature wouldn't automatically clean up the manifest entry. Undo would need to roll back both.

**Rationale:** The feature/sketch/variable record IS the import record. Binding metadata travels with it through all existing operations (delete, undo, reorder) without special handling.

### 4. Source transport is the orchestrator's responsibility

**Decision:** Providers receive `ResolvedImportSource` with `bytes: Uint8Array` already fetched. The orchestrator handles local file reads, URL fetches, and cloud API calls.

**Alternative considered:** Providers receive the raw `ImportSource` union and handle transport themselves. This forces every provider to implement fetch/read logic and deal with transport errors.

**Rationale:** Providers are data transformers. They parse bytes and return structured results. Transport is orthogonal — one orchestrator implementation covers all providers.

### 5. Providers are stateless across review/prepare

**Decision:** `review()` returns a typed result. `prepare()` receives that result back along with the source and user selections. No token, no session.

**Alternative considered:** A `reviewToken` that the provider uses to cache parsed state between review and prepare. This requires cleanup on abandon, timeout semantics, and concurrent review handling.

**Rationale:** For most formats, re-parsing bytes in `prepare()` is trivially fast. For expensive formats (large STEP assemblies), the provider can use `ImportCapabilities` to do the expensive work in `review()` and return the intermediate result as part of its review data — the orchestrator holds it in memory and passes it back.

### 6. Refresh is re-running the provider, not a special operation

**Decision:** Refresh = re-fetch source from binding → run `provider.review()` + `provider.prepare()` → diff against existing entities → apply updates through `adapter.updateFeature()` etc.

**Alternative considered:** A dedicated `refresh()` method on providers. This duplicates the review/prepare flow and forces providers to understand the difference between first-import and refresh.

**Rationale:** The provider doesn't know or care if it's a first import or a refresh. It transforms bytes into prepared actions. The orchestrator handles diffing and update routing.

### 7. FileSystemFileHandle storage lives in the document-sync layer

**Decision:** A workspace-level `ImportBindingStore` stores `FileSystemFileHandle` references outside the document, consistent with `local-file-system-document-sync`.

**Alternative considered:** Storing handles (or references to them) in the document JSON. Browser `FileSystemFileHandle` objects are not serializable to JSON and are not portable across browsers/machines.

**Rationale:** The binding record in the document says `kind: 'localFile'` with a display path hint. The actual capability to access that file lives in the workspace binding store, just like the existing local file sync handle.

## Risks / Trade-offs

**[Provider re-parsing overhead]** → Stateless providers may re-parse source bytes in `prepare()` that were already parsed in `review()`. Mitigation: providers can include parsed intermediate data in their review result; the orchestrator holds it in memory between phases. For truly large files, `ImportCapabilities` methods can cache internally.

**[Feature definition coupling]** → Providers must construct valid `FeatureDefinition` variants, which ties them to the modeling contract schema. Mitigation: `ImportCapabilities` provides builder methods that construct valid definitions, so providers don't hand-craft feature JSON.

**[Binding metadata on existing records]** → Adding optional import binding fields to `AuthoredFeatureRecord`, `AuthoredSketchRecord`, and `DocumentVariableRecord` slightly expands their schema. Mitigation: fields are optional and only present for imported entities. Existing documents are unaffected.

**[Multi-file imports]** → Some formats (STEP assemblies with external references) involve multiple files that only the provider understands. The orchestrator resolves transport for a primary source; the provider's review may request additional sources that the orchestrator then resolves in a second round. This two-round pattern adds complexity but keeps transport ownership clear.

**[Breaking existing STEP/mesh tests]** → All E2E and unit tests touching the current import paths will need rewriting when the old feature kinds are replaced. Mitigation: this is contract-only; the actual migration happens when providers are implemented.
