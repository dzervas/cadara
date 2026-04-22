## 1. Contracts And Asset Model

- [x] 1.1 Add multi-file STEP import contract types for root asset, referenced source assets, resolved document names, selected solid keys, and selected solid labels.
- [x] 1.2 Add or version runtime schemas for multi-file STEP import parameters while preserving existing single-file STEP import validation.
- [x] 1.3 Add structured diagnostics for missing referenced STEP files, ambiguous referenced file matches, unreadable referenced files, stale selected solid keys, and empty selection.
- [x] 1.4 Extend geometry asset provenance metadata so retained STEP assets can record the selected local file name and STEP document reference name they satisfy.
- [x] 1.5 Add contract tests for valid multi-file STEP imports, invalid missing-reference payloads, stale selection diagnostics, and backward-compatible single-file STEP import definitions.

## 2. STEP Review And OCC Import

- [x] 2.1 Add a STEP import review preparation API that accepts multiple STEP file byte inputs and returns discovered solid rows plus diagnostics without committing document history.
- [x] 2.2 Implement root assembly reference scanning and deterministic selected-file matching by normalized STEP document basename.
- [x] 2.3 Write root and referenced STEP bytes into the OCC virtual filesystem during review and rebuild so external document references resolve.
- [x] 2.4 Extract supported solid rows with deterministic solid keys, source file names, default labels, and importability status for the review modal.
- [x] 2.5 Update STEP import rebuild to filter imported solids by accepted selection keys and report stale-selection diagnostics when keys cannot be resolved.
- [x] 2.6 Add OCC/modeling tests for monolithic STEP review, external-reference assembly review, missing sibling files, duplicate/ambiguous sibling names, subset import, and save/rebuild parity.

## 3. Modeling Service And Persistence

- [x] 3.1 Add modeling service methods for preparing a STEP import review and committing a prepared multi-file STEP import.
- [x] 3.2 Store root and required referenced STEP files as immutable geometry assets owned by the import feature.
- [x] 3.3 Ensure saved `.cadara` packages include all retained STEP source assets needed by multi-file imports.
- [x] 3.4 Ensure document restore and repository sync validate and provide every referenced STEP asset to the OCC rebuild path.
- [x] 3.5 Add repository and asset-store tests proving multi-file STEP imports reopen in a fresh runtime without original local files.

## 4. Mantine Workbench UI

- [x] 4.1 Update the Import Part picker and file-change handling to accept multiple STEP files while continuing to reject mixed STEP, mesh, and document import selections.
- [x] 4.2 Replace the basic STEP modal content with a Mantine review state that shows preparation progress, diagnostics, and discovered solid rows.
- [x] 4.3 Add a compact Mantine solid selection list using per-row checkboxes and a top global checkbox with checked, unchecked, and indeterminate states.
- [x] 4.4 Disable the Import action when no importable solids are selected and show a visible message explaining that at least one solid is required.
- [x] 4.5 Commit only selected solid keys from the modal and refresh the workbench after successful import.
- [x] 4.6 Add focused UI/model tests for multi-file file selection, select-all toggle behavior, empty-selection disabling, diagnostics display, and selected-subset commit payloads.

## 5. Verification

- [x] 5.1 Add or update regression coverage using the external-reference assembly fixture that previously produced a no-solids message.
- [x] 5.2 Run `bun run test`.
- [x] 5.3 Run `bun run lint`.
- [x] 5.4 Run `bun run build`.
