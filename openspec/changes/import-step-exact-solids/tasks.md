## 1. Contracts

- [ ] 1.1 Add STEP import feature definition types and runtime schemas.
- [ ] 1.2 Add import setting types for asset id, unit/scale resolution, orientation, placement transform, and label.
- [ ] 1.3 Add STEP import diagnostics for unreadable files, unsupported structure, no solids, and missing assets.
- [ ] 1.4 Add contract tests for valid and invalid STEP import definitions.

## 2. OCC Import And Restore

- [ ] 2.1 Add worker-safe STEP asset reading through the OCC runtime.
- [ ] 2.2 Convert supported STEP shapes into tracked exact bodies using existing topology tracking.
- [ ] 2.3 Flatten supported STEP solids into separate document bodies with deterministic labels and produced targets.
- [ ] 2.4 Add restore tests proving single-body and multi-body imported solids expose selectable body, face, edge, and vertex refs.
- [ ] 2.5 Add diagnostics/tests for files with no supported solids and files with skipped unsupported non-solid content.

## 3. Authoring And UI

- [ ] 3.1 Add workbench import entry for `.step` and `.stp` files.
- [ ] 3.2 Add import flow state for file validation, settings review, progress, cancellation, and error reporting.
- [ ] 3.3 Store accepted STEP source bytes as geometry assets and commit a STEP import feature referencing the asset.
- [ ] 3.4 Add focused UI/model tests for valid import, invalid file, missing asset, and settings persistence.

## 4. Persistence And Verification

- [ ] 4.1 Verify local save/open round-trips STEP source bytes inside the self-contained document.
- [ ] 4.2 Verify repository peer sync automatically transfers STEP assets and rebuilds the imported body.
- [ ] 4.3 Verify downstream feature refs can target imported STEP body topology.
- [ ] 4.4 Run `bun run test`, `bun run lint`, and `bun run build`.
