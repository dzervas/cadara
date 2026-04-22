## 1. Contracts

- [x] 1.1 Add STEP import feature definition types and runtime schemas.
- [x] 1.2 Add import setting types for asset id, unit/scale resolution, orientation, placement transform, and label.
- [x] 1.3 Add STEP import diagnostics for unreadable files, unsupported structure, no solids, and missing assets.
- [x] 1.4 Add contract tests for valid and invalid STEP import definitions.

## 2. OCC Import And Restore

- [x] 2.1 Add worker-safe STEP asset reading through the OCC runtime.
- [x] 2.2 Convert supported STEP shapes into tracked exact bodies using existing topology tracking.
- [x] 2.3 Flatten supported STEP solids into separate document bodies with deterministic labels and produced targets.
- [x] 2.4 Add restore tests proving single-body and multi-body imported solids expose selectable body, face, edge, and vertex refs.
- [x] 2.5 Add diagnostics/tests for files with no supported solids and files with skipped unsupported non-solid content.

## 3. Authoring And UI

- [x] 3.1 Add workbench import entry for `.step` and `.stp` files.
- [x] 3.2 Add import flow state for file validation, settings review, progress, cancellation, and error reporting.
- [x] 3.3 Store accepted STEP source bytes as geometry assets and commit a STEP import feature referencing the asset.
- [x] 3.4 Add focused UI/model tests for valid import, invalid file, missing asset, and settings persistence.

## 4. Persistence And Verification

- [x] 4.1 Verify local save/open round-trips STEP source bytes inside the self-contained document.
- [x] 4.2 Verify repository peer sync automatically transfers STEP assets and rebuilds the imported body.
- [x] 4.3 Verify downstream feature refs can target imported STEP body topology.
- [x] 4.4 Run `bun run test`, `bun run lint`, and `bun run build`.
