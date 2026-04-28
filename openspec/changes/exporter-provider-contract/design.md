## Context

Export currently lives inside the modeling kernel adapter: `ModelingKernelAdapter.exportDocument()` dispatches to a monolithic `exportOccGeometryDocument()` function that switches on format and calls format-specific helpers (`exportStl`, `exportStep`, `exportThreeMf`). Adding a new format means editing kernel adapter code, the geometry-export switch, and the export contract's format union — all deep in core infrastructure.

The import side already solved the analogous problem with `ImportProvider`, a provider registry, and an orchestrator that resolves sources → matches providers → drives a review/prepare lifecycle. The export side needs a similar plug-in boundary so format authors only implement a focused interface and register it.

Cadara export is a document-level JSON serialization, not a geometry export. It stays in the modeling service and does not participate in the provider system.

## Goals / Non-Goals

**Goals:**
- Define an `ExportProvider` interface simple enough that adding a format is one file with one interface implementation.
- Create a provider registry with the same discovery/match API shape as the import side.
- Migrate STL, 3MF, and STEP into standalone providers.
- Remove the format-routing code in the kernel adapter and geometry-export module.
- Keep the export modal working with a provider-driven format list and option form.

**Non-Goals:**
- Async streaming or chunked export — payloads remain fully buffered.
- Export preview or review step — export providers produce a payload directly; no multi-step lifecycle like import's review → prepare.
- Moving cadara export into the provider system.
- Changing the export modal's visual design or UX flow.

## Decisions

### 1. Simpler lifecycle than ImportProvider — no review/selections phase

Import providers need a review step because the user must inspect and select from the imported content. Export is the inverse: the user already chose what to export and configured options in the modal. The provider just needs to produce bytes.

The `ExportProvider` interface therefore has:
- `id`, `label`, `formatId`, `fileExtension`, `mimeType` — static metadata.
- `getDefaultOptions()` — returns the provider's default option values.
- `getOptionFormSchema(options)` — returns a `FeatureEditorFormSchema` for the export modal to render.
- `applyOptionPatch(options, patch)` — applies a user form change to the options object.
- `export(input)` — takes the geometry/body reference and options, returns the payload or diagnostics.

**Alternative considered:** Mirroring the full import lifecycle (review → selections → prepare). Rejected because export has no equivalent of "reviewing discovered content" — the user already knows the target and format.

### 2. Providers receive an ExportCapabilities bag, not raw kernel access

Like `ImportCapabilities`, providers get an `ExportCapabilities` object that exposes only the services they need (e.g., mesh tessellation, B-Rep writer access). This keeps providers decoupled from the kernel adapter internals.

For the initial three providers the capabilities bag needs:
- Access to the OCC shape for the target body.
- Mesh tessellation service (for STL and 3MF).
- STEP writer service (for STEP).

**Alternative considered:** Passing the full kernel adapter. Rejected because it leaks kernel internals and makes testing harder.

### 3. Registry mirrors the import provider registry pattern

A `getRegisteredExportProviders()`, `getExportProviderByFormat(format)`, `matchExportProviders(format)` API. Providers are registered at app startup. Test helpers for dynamic registration/reset, same as import.

### 4. Format union type becomes provider-driven

`DocumentExportFormat` currently hard-codes `'stl' | 'step' | '3mf' | 'cadara'`. With providers, geometry formats come from the registry. Cadara remains special-cased. The union type is removed from the contract; format IDs are strings that providers declare.

### 5. Provider files live in `src/domain/export/providers/`

One file per provider: `stl-export-provider.ts`, `step-export-provider.ts`, `threemf-export-provider.ts`. The contract interface lives in `src/contracts/export/provider.ts`. The registry lives in `src/domain/export/provider-registry.ts`.

## Risks / Trade-offs

- **[Risk] ExportCapabilities coupling to OCC** — The initial capabilities bag will expose OCC-specific services (tessellation, STEP writer). If a non-OCC kernel is ever added, capabilities will need an abstraction layer. → Mitigation: Keep the capabilities interface narrow; providers should not depend on OCC types directly. The capabilities bag can be backed by different kernels behind the interface.

- **[Risk] Cadara special-casing** — Keeping cadara outside the provider system means two export paths. → Mitigation: Cadara is fundamentally different (document serialization vs geometry conversion). The complexity of forcing it into a geometry provider interface outweighs the consistency benefit.

- **[Trade-off] No async streaming** — Large models produce large STL/3MF files. Buffering the entire payload in memory is the current behavior and is preserved. Streaming can be added later as a provider capability without changing the interface (the payload type already supports `Uint8Array`).
