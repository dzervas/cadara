> Status: paused. The `Import Part` toolbar entry is hidden behind `?cadEnablePartImport=1` while STEP exact persistence/materialization regressions are unresolved.

## 1. Contract And Schema Cleanup

- [x] 1.1 Replace ZIP/package `.cadara` contract assumptions with single authored JSON object assumptions in document export, document import, local sync, and geometry asset tests.
- [x] 1.2 Remove `baked-mesh` as a separately packageable geometry asset format from persistence-facing contracts and runtime validation.
- [x] 1.3 Add or update schema validation for JSON-resident translated STEP B-rep data and structured baked mesh geometry records.
- [x] 1.4 Ensure invalid ZIP-backed `.cadara` payloads fail with visible diagnostics and no backwards-compatible extraction path.

## 2. Remove ZIP Package Handling

- [x] 2.1 Remove `src/lib/cadara-package.ts` and related ZIP package helper tests/imports.
- [x] 2.2 Remove `.cadara` package MIME branching and package payload creation from current-document export.
- [x] 2.3 Remove package parsing from document import/open flows so `.cadara` is parsed directly as one JSON object.
- [x] 2.4 Remove local file sync package asset collection/writing for `.cadara` autosync.

## 3. Geometry Persistence

- [x] 3.1 Translate STEP/STP source payloads into authored Cadara B-rep JSON before persistence.
- [x] 3.2 Preserve selected multi-file STEP solid intent without saving STEP source files.
- [x] 3.3 Convert any persisted baked mesh output from standalone asset bytes to structured, format-neutral authored JSON data, or reject mesh imports that cannot be represented that way.
- [x] 3.4 Ensure STL and 3MF source bytes are discarded after transient import review and never appear in saved `.cadara` JSON.
- [x] 3.5 Ensure persisted Cadara B-rep data is kernel-neutral JSON topology/geometry and does not contain OpenCascade-specific serialized BRep strings.
- [x] 3.6 Route STEP review and Cadara geometry baking through the OpenCascade worker when available so large imports do not block the workbench UI thread.
- [x] 3.7 Close the STEP review modal after accept and show background baking progress in the lower-right workbench progress surface.
- [x] 3.8 Validate prepared STEP Cadara B-rep assets structurally before persistence without requiring a pre-commit OCC restore.
- [x] 3.9 Add a direct faceted presentation/snapshot path for persisted Cadara B-rep bodies so accepted STEP imports can become visible without waiting for full OCC materialization.
- [x] 3.10 Separate persisted import completion from background OCC materialization and ensure the import flow has bounded completion behavior instead of waiting indefinitely.
- [x] 3.11 Add restore/materialization instrumentation and structured diagnostics for Cadara-B-rep bridge generation, OCC read/restore, solid construction, tracked-body setup, topology naming, and snapshot/render generation.
- [x] 3.12 Reduce, defer, or otherwise bound eager topology naming work for large imported faceted bodies so initial materialization does not dominate import completion.

## 4. Workbench UI

- [x] 4.1 Add a “Probably Broken” chip near the title of the STL/3MF import review modal.
- [x] 4.2 Keep mesh import diagnostics, reconstruction quality, and source-discard warning visible with the new chip.
- [x] 4.3 Update document import/export error copy to describe unsupported packaged `.cadara` files when ZIP payloads are selected.
- [x] 4.4 Update STEP import progress behavior so lower-right import progress completes when persisted presentation is ready, while background OCC materialization reports separately.
- [x] 4.5 Surface clear feature/workbench diagnostics when background STEP materialization is pending, degraded, timed out, or failed after persistence.

## 5. Verification

- [x] 5.1 Add or update unit coverage for single JSON `.cadara` export/import with translated STEP geometry data.
- [x] 5.2 Add or update local file sync coverage proving bound writes serialize one JSON object and do not write ZIP packages.
- [x] 5.3 Add or update mesh import coverage proving no `baked-mesh` blob asset is persisted.
- [x] 5.4 Run `bun run test`, `bun run lint`, and `bun run build`.
- [x] 5.5 Add regression coverage proving prepared STEP import skips pre-persist kernel rebuild validation.
- [x] 5.6 Add coverage proving large accepted STEP imports clear user-visible progress after persisted faceted presentation is available, even when OCC materialization is slower.
- [x] 5.7 Add coverage for background STEP materialization diagnostics and bounded completion behavior.
