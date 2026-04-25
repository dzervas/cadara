## 1. Contract And Schema Cleanup

- [ ] 1.1 Replace ZIP/package `.cadara` contract assumptions with single authored JSON object assumptions in document export, document import, local sync, and geometry asset tests.
- [ ] 1.2 Remove `baked-mesh` as a separately packageable geometry asset format from persistence-facing contracts and runtime validation.
- [ ] 1.3 Add or update schema validation for JSON-resident retained STEP source data and structured baked mesh geometry records.
- [ ] 1.4 Ensure invalid ZIP-backed `.cadara` payloads fail with visible diagnostics and no backwards-compatible extraction path.

## 2. Remove ZIP Package Handling

- [ ] 2.1 Remove `src/lib/cadara-package.ts` and related ZIP package helper tests/imports.
- [ ] 2.2 Remove `.cadara` package MIME branching and package payload creation from current-document export.
- [ ] 2.3 Remove package parsing from document import/open flows so `.cadara` is parsed directly as one JSON object.
- [ ] 2.4 Remove local file sync package asset collection/writing for `.cadara` autosync.

## 3. Geometry Persistence

- [ ] 3.1 Store retained STEP/STP source payloads inside the authored JSON document in a Cadara-friendly representation that rebuilds equivalent OCC input bytes.
- [ ] 3.2 Preserve multi-file STEP root/reference source mappings in JSON-resident records.
- [ ] 3.3 Convert any persisted baked mesh output from standalone asset bytes to structured, format-neutral authored JSON data, or reject mesh imports that cannot be represented that way.
- [ ] 3.4 Ensure STL and 3MF source bytes are discarded after transient import review and never appear in saved `.cadara` JSON.

## 4. Workbench UI

- [ ] 4.1 Add a “Probably Broken” chip near the title of the STL/3MF import review modal.
- [ ] 4.2 Keep mesh import diagnostics, reconstruction quality, and source-discard warning visible with the new chip.
- [ ] 4.3 Update document import/export error copy to describe unsupported packaged `.cadara` files when ZIP payloads are selected.

## 5. Verification

- [ ] 5.1 Add or update unit coverage for single JSON `.cadara` export/import with retained STEP data.
- [ ] 5.2 Add or update local file sync coverage proving bound writes serialize one JSON object and do not write ZIP packages.
- [ ] 5.3 Add or update mesh import coverage proving no `baked-mesh` blob asset is persisted.
- [ ] 5.4 Run `bun run test`, `bun run lint`, and `bun run build`.
