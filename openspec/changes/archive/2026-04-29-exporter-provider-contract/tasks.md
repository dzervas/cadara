## 1. Export Provider Contract

- [x] 1.1 Create `src/contracts/export/provider.ts` with the `ExportProvider` interface (`id`, `label`, `formatId`, `fileExtension`, `mimeType`, `getDefaultOptions`, `getOptionFormSchema`, `applyOptionPatch`, `export`)
- [x] 1.2 Create `src/contracts/export/capabilities.ts` with the `ExportCapabilities` interface (mesh tessellation service, B-Rep writer service, target body shape access)
- [x] 1.3 Create `src/contracts/export/result.ts` with `ExportResult` (success with payload + diagnostics, failure with diagnostics) — reuse or adapt existing `DocumentExportDiagnostic`
- [x] 1.4 Create `src/contracts/export/index.ts` barrel export

## 2. Export Provider Registry

- [x] 2.1 Create `src/domain/export/provider-registry.ts` with `getRegisteredExportProviders()`, `getExportProviderByFormat(formatId)`, `registerExportProviderForTest()`, `resetExportProvidersForTest()`
- [x] 2.2 Create startup registration that registers the three built-in providers

## 3. Migrate STL Export to Provider

- [x] 3.1 Create `src/domain/export/providers/stl-export-provider.ts` implementing `ExportProvider`
- [x] 3.2 Move STL-specific logic (tessellation, ASCII/binary encoding) from `geometry-export.ts` into the provider, using `ExportCapabilities` for mesh access

## 4. Migrate STEP Export to Provider

- [x] 4.1 Create `src/domain/export/providers/step-export-provider.ts` implementing `ExportProvider`
- [x] 4.2 Move STEP-specific logic (OCC STEP writer configuration, schema/unit options) from `geometry-export.ts` into the provider, using `ExportCapabilities` for writer access

## 5. Migrate 3MF Export to Provider

- [x] 5.1 Create `src/domain/export/providers/threemf-export-provider.ts` implementing `ExportProvider`
- [x] 5.2 Move 3MF-specific logic (tessellation, XML generation, ZIP packaging) from `geometry-export.ts` into the provider, using `ExportCapabilities` for mesh access

## 6. Export Orchestrator

- [x] 6.1 Create `src/domain/export/export-orchestrator.ts` that resolves target, matches provider by format, calls `provider.export()`, and returns result — with cadara fallback to existing document JSON path
- [x] 6.2 Create `ExportCapabilities` implementation that bridges the OCC kernel (tessellation + STEP writer + shape access) into the capabilities interface

## 7. Wire Up and Remove Legacy Code

- [x] 7.1 Update `ModelingKernelAdapter` — remove `exportDocument` method from the interface and both implementations (OpenCascade + Mock)
- [x] 7.2 Update `modeling-service.ts` — replace `exportDocument` with a call to the export orchestrator for geometry formats, keep cadara path
- [x] 7.3 Remove the monolithic `exportOccGeometryDocument()` entry point and any now-unused format-routing code from `geometry-export.ts`
- [x] 7.4 Clean up `src/contracts/modeling/export.ts` — remove the hard-coded format union, `DocumentExportRequest` discriminated union, and format-specific option types that have moved into providers

## 8. Update Export Modal

- [x] 8.1 Update the export modal to query the provider registry for available geometry formats instead of using a hard-coded format list
- [x] 8.2 Update the export modal to use `getOptionFormSchema()` / `applyOptionPatch()` from the matched provider for rendering format-specific options

## 9. Tests

- [x] 9.1 Add unit tests for the export provider registry (register, lookup, test helpers)
- [x] 9.2 Add unit tests for each provider (STL, STEP, 3MF) verifying option forms and export output
- [x] 9.3 Update or remove existing export tests that depend on the removed `ModelingKernelAdapter.exportDocument` path
