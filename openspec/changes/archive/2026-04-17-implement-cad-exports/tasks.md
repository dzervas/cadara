## 1. Export Test Coverage

- [x] 1.1 Add OCC adapter tests that create a simple live solid body and reproduce the current unavailable STL, STEP, and 3MF export failures.
- [x] 1.2 Add OCC adapter tests for stale revision, missing body target, and non-body target export diagnostics.
- [x] 1.3 Add payload assertions for successful STL, STEP, and 3MF exports, including extension, MIME type, non-empty payload, and format-specific file signatures.

## 2. OCC Export Helpers

- [x] 2.1 Add a focused OCC geometry export helper module for resolving selected body targets from `OccAuthoringState`.
- [x] 2.2 Add helper utilities for temporary OpenCascade.js filesystem paths, reading writer output, and removing temporary files after each export attempt.
- [x] 2.3 Add shared diagnostic helpers for unexportable targets, empty mesh output, writer failures, and unavailable format support.

## 3. STEP Export

- [x] 3.1 Implement STEP export for live body shapes using OpenCascade `STEPControl_Writer`.
- [x] 3.2 Map the requested STEP schema and millimeter unit option to writer configuration, or return an explicit writer-unavailable diagnostic when unsupported.
- [x] 3.3 Make the STEP OCC tests pass without changing the public `DocumentExportRequest` or `DocumentExportResult` shapes.

## 4. STL Export

- [x] 4.1 Mesh the selected body using STL mesh accuracy options before writing output.
- [x] 4.2 Implement STL writer support for the contract's binary and ASCII encodings, or return a format-specific diagnostic for an unsupported encoding.
- [x] 4.3 Make the STL OCC tests pass with non-synthetic geometry payloads.

## 5. 3MF Export

- [x] 5.1 Check whether the bundled OpenCascade.js browser and node runtimes expose a usable native 3MF writer.
- [x] 5.2 Implement 3MF export through the native writer when available, otherwise add a direct ZIP/package dependency and generate a minimal valid 3MF mesh package from tessellated body triangles.
- [x] 5.3 Honor the 3MF mesh accuracy and millimeter unit options in the generated package.
- [x] 5.4 Make the 3MF OCC tests pass with a valid package payload and no mock placeholder content.

## 6. Integration Cleanup

- [x] 6.1 Replace the `occ-export-unavailable` success path blocker in `OpenCascadeKernelAdapter.exportDocument` with format dispatch to the new helpers.
- [x] 6.2 Keep cadara export in `ModelingService` unchanged and ensure mock adapter tests still cover service/UI behavior without pretending to validate real geometry files.
- [x] 6.3 Run `bun run test`.
- [x] 6.4 Run `bun run lint`.
