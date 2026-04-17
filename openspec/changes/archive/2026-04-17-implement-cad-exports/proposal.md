## Why

The export modal now exposes STL, STEP, and 3MF choices, but the OpenCascade adapter still reports geometry export as unavailable while the mock adapter returns synthetic payloads. Users need those export choices to produce real files from the modeled solid bodies.

## What Changes

- Implement OpenCascade-backed STL, STEP, and 3MF export generation for exportable body targets.
- Replace mock geometry payload assumptions in tests with assertions that distinguish mock service coverage from real OCC serialization coverage.
- Preserve the existing export modal, request validation, cadara JSON export path, revision checks, and diagnostic-first failure behavior.
- Return clear diagnostics when a selected target has no exportable solid shape or when a browser/OpenCascade runtime cannot support a requested writer.
- Add focused tests that build a simple OCC solid and verify non-empty, format-appropriate STL, STEP, and 3MF payloads.

## Capabilities

### New Capabilities
- `geometry-file-export`: Defines real kernel-backed STL, STEP, and 3MF file generation from exportable modeled bodies.

### Modified Capabilities
- None.

## Impact

- Affected domain/kernel code: `OpenCascadeKernelAdapter.exportDocument`, body target resolution, tessellation/export helpers, and writer/runtime capability diagnostics.
- Affected contracts: likely no public request shape changes; payload metadata and diagnostics must continue to satisfy existing `DocumentExportResult` schemas.
- Affected tests: OCC adapter export tests for STL, STEP, and 3MF payloads; existing modeling service and modal tests should continue to pass.
- Related active change: builds on the export modal and `DocumentExportResult` contract introduced by `add-export-modal`.
- Dependencies: may require using OpenCascade.js writer APIs already bundled with the app, plus a small internal ZIP/package helper for 3MF only if OpenCascade.js does not provide a usable 3MF writer in the browser runtime.
