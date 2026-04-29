## Why

Export formats (STL, 3MF, STEP) are currently hard-wired into the modeling kernel adapter and a monolithic geometry-export module, making it impossible to add new formats without touching core kernel code. The import side already solved this with an `ImportProvider` contract and a provider registry. Exporting needs the same treatment so contributors can add formats by implementing a single interface and registering it, without understanding kernel internals.

## What Changes

- **BREAKING** Introduce an `ExportProvider` contract modeled after `ImportProvider` — a stateless interface that declares accepted formats, exposes schema-driven option forms, and produces export payloads.
- **BREAKING** Introduce an export provider registry (analogous to the import provider registry) for discovering and matching providers by format.
- Migrate the three existing geometry exporters (STL, 3MF, STEP) into standalone `ExportProvider` implementations that live in `src/domain/export/providers/`.
- **BREAKING** Remove the format-routing switch in `exportOccGeometryDocument()` and the direct `exportDocument` method on `ModelingKernelAdapter` — the export orchestrator routes to the matched provider instead.
- Keep cadara export as a special case handled by the modeling service (it serializes document JSON, not geometry) — it does not become an ExportProvider.

## Capabilities

### New Capabilities
- `export-provider-contract`: Defines the `ExportProvider` interface, its lifecycle (validate → export), the provider registry, and the orchestrator that wires providers to the export modal and download flow.

### Modified Capabilities
- `document-export`: The export modal and download flow must use the provider registry to discover available formats and delegate payload generation to the matched provider instead of hard-coding format switches.
- `geometry-file-export`: Individual format export logic moves from the monolithic geometry-export module into per-format provider implementations; the kernel adapter no longer owns geometry export routing.

## Impact

- `src/contracts/modeling/export.ts` — format union types and `DocumentExportRequest` will be replaced by provider-scoped option types.
- `src/contracts/modeling/adapter.ts` — `exportDocument` removed from `ModelingKernelAdapter`.
- `src/domain/modeling/occ/geometry-export.ts` — format-specific functions extracted into providers; the monolithic export entry point removed.
- `src/domain/modeling/opencascade-kernel-adapter.ts` — geometry export delegation removed.
- `src/domain/modeling/mock-kernel-adapter.ts` — mock export delegation removed.
- `src/domain/modeling/modeling-service.ts` — `exportDocument` reworked to use provider registry.
- New files under `src/contracts/export/` and `src/domain/export/`.
- Export modal component updated to query provider registry for available formats.
