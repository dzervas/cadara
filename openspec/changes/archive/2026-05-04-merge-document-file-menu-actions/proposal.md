## Why

The file menu currently exposes overlapping document actions: local open/save for filesystem-bound documents and import/export for one-shot browser file operations. That split makes users choose implementation details before they understand the task; the menu should present the document intent first, then explain the storage choice only when it matters.

## What Changes

- **BREAKING**: Replace the document file menu with only `New`, `Open...`, and `Save As`.
- `New` opens a fresh document in a new active tab with no filesystem connection.
- `Open...` opens a modal that lets the user choose between:
  - opening a document from browser storage/file upload without linking future changes to that file
  - opening a document with direct filesystem access so future changes can save back to the chosen file
- `Open...` always creates and activates a new document tab when a document is successfully opened.
- `Save As` opens a modal that lets the user choose between:
  - downloading a portable `.cadara` copy through the normal browser download path
  - saving with direct filesystem access so future changes can save back to the chosen file
- The modal copy must explain the difference in one precise sentence for non-technical users and must not mention implementation names like "API", "File System Access API", "import", or "export".
- Existing one-shot document import/export behavior remains available through the `Open...` and `Save As` modal choices instead of top-level file menu items.
- Tests covering the file menu, document open/save actions, tab creation, and storage-kind updates must be updated to the new labels and modal-driven choices.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `workbench-document-file-menu`: Replace the old New/Open local/Save local/Import/Export menu contract with the unified New/Open.../Save As contract and modal choice wording.
- `workbench-document-tabs`: Require `New` and successful `Open...` flows to create and activate a new tab without replacing the previously active tab.
- `local-file-system-document-sync`: Reframe local filesystem open/save flows as direct-file choices inside Open... and Save As rather than separate top-level menu items, while preserving document-scoped bindings.

## Impact

- Affected UI: `DocumentFileMenu`, workspace toolbar wiring, the new Open/Save As choice modal, and related copy.
- Affected application seams: workbench document actions for new document, one-shot document open, direct filesystem open, one-shot document save/download, and direct filesystem Save As.
- Affected persistence behavior: browser-only documents remain unbound; direct filesystem choices create or update document-scoped filesystem bindings and storage kind.
- Affected tests: UI-lane file menu/modal coverage, application-lane document action coverage, and any e2e/browser coverage that asserts top-level file menu labels or open/save tab behavior.
