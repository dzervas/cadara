## 1. File Menu Model And Modals

- [x] 1.1 Replace the document file menu model with exactly `New`, `Open...`, and `Save As`, removing old top-level `New document`, `Open local file`, `Save local file`, `Import`, and `Export` command ids.
- [x] 1.2 Move one-shot document file input ownership out of `DocumentFileMenu` and behind the Open... modal choice flow.
- [x] 1.3 Add Open Document and Save As modal components using Mantine primitives and the exact non-technical option copy from the spec.
- [x] 1.4 Wire `Open...` to the copy-open and linked-open actions, and wire `Save As` to the download-copy and linked-save actions.

## 2. Document Action Semantics

- [x] 2.1 Make `New` create and activate a fresh browser-only document tab without reusing or replacing the previously active tab.
- [x] 2.2 Make Open a copy validate a selected `.cadara`/JSON authored document, create and activate a new browser-backed tab, and leave the previous tab unchanged.
- [x] 2.3 Make Open and keep linked validate a selected `.cadara`/JSON authored document, create and activate a new tab, bind the selected file handle to that new document identity, and leave the previous tab unchanged.
- [x] 2.4 Make Download a copy export the current `.cadara` document without changing any existing filesystem binding.
- [x] 2.5 Make Save and keep linked write the current document to the chosen file handle, bind that handle to the active document, and update the active tab storage kind to filesystem.
- [x] 2.6 Preserve existing invalid-file, ZIP-package, cancellation, permission-denied, and unsupported-browser failure behavior through the new modal choices.

## 3. Test Updates

- [x] 3.1 UI lane: update file-menu rendering tests to assert the three-item menu, removed old labels, modal opening, exact option copy, and modal choice event wiring.
- [x] 3.2 UI lane: update toolbar/workbench shell tests that pass document file handlers so they use the new Open... and Save As handler surface.
- [x] 3.3 Application lane: update workbench document action tests for New, Open a copy, Open and keep linked, Download a copy, Save and keep linked, failure paths, and no stale filesystem binding across tabs.
- [x] 3.4 Application lane: add or update tab/storage-kind coverage proving New and successful Open... flows create active tabs and bind direct filesystem handles only to the new document identity.
- [x] 3.5 E2E lane: update browser file-menu coverage only if existing Playwright tests assert the old Import/Export/Open local/Save local menu labels or if modal-to-picker behavior cannot be proven through UI/application tests.

## 4. Validation

- [x] 4.1 Run `bun run test:all` and fix any failures caused by the file-menu contract change.
- [x] 4.2 Run `openspec status --change merge-document-file-menu-actions` and confirm the change is apply-ready.
