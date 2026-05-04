## Context

The current document file menu exposes implementation-shaped actions: `Open local file` and `Save local file` use direct filesystem handles and keep syncing future changes, while `Import` and `Export` are one-shot browser file operations. The application now has multi-document tabs, so document-opening flows should create and activate tabs instead of replacing the current tab in place.

The user-facing problem is not missing capability; it is that the top-level menu makes non-technical users choose between storage mechanisms before they have chosen the document action. The new contract keeps the menu small and moves the storage distinction into focused modals for `Open...` and `Save As`.

## Goals / Non-Goals

**Goals:**

- Make the document file menu contain exactly `New`, `Open...`, and `Save As`.
- Make `New` create and activate a fresh browser-only document tab with no filesystem binding.
- Make successful `Open...` choices create and activate a new tab.
- Preserve both document open paths:
  - one-shot file upload that opens a browser-only copy
  - direct filesystem open that binds future changes to the selected file
- Preserve both document save paths:
  - one-shot `.cadara` download
  - direct filesystem Save As that binds future changes to the selected file
- Explain the storage choice in one concise sentence per option using non-technical wording.
- Update the tests that currently assert old labels, top-level import/export handlers, direct local-file labels, tab behavior, and storage-kind behavior.

**Non-Goals:**

- Redesign object-level geometry import/export, the part-mode import toolbar, or Parts & Objects export modals.
- Introduce cloud storage or collaboration flows.
- Add ZIP-backed `.cadara` package support.
- Preserve old top-level file menu labels or compatibility aliases.

## Decisions

1. **Use intent-first top-level commands.**

   The menu model becomes three commands: `newDocumentTab`, `openDocument`, and `saveDocumentAs`. `Open local file`, `Save local file`, `Import`, `Export`, and the duplicate `New document` item are removed from the top-level model. This keeps the toolbar file menu aligned with what the user is trying to do instead of how the browser performs file access.

   Alternative considered: keep import/export as advanced menu items under a divider. Rejected because it preserves the confusing split the change is meant to remove.

2. **Use modal choices for storage behavior.**

   `Open...` opens an `OpenDocumentModal`; `Save As` opens a `SaveAsDocumentModal`. Each modal offers two choices:

   - Open a copy: "Choose a .cadara file; CADara opens it in a new tab, and future changes stay in browser storage until you save again."
   - Open and keep linked: "Choose a .cadara file; CADara opens it in a new tab and keeps future changes saving to that same file on your computer."
   - Download a copy: "CADara downloads a portable .cadara file; future changes stay in browser storage until you save again."
   - Save and keep linked: "Choose where to save; CADara writes this document there and keeps future changes saving to that same file on your computer."

   These sentences avoid implementation names such as "API", "File System Access API", "import", and "export" while still describing the lasting effect of each choice.

   Alternative considered: use "browser" vs "filesystem" labels. Rejected for primary labels because they are implementation terms; those concepts can remain in code and `storageKind`, but the UI copy should describe the user-visible outcome.

3. **Keep existing document action seams, but rename them around the new commands.**

   The current action bodies already map to the desired behaviors: one-shot document import, direct filesystem open, one-shot export download, and direct filesystem Save As. Implementation should consolidate these behind `requestOpenDocument(choice)` and `requestSaveDocumentAs(choice)` style seams rather than letting the presentational menu own hidden file inputs or direct action branching.

   Alternative considered: make the modal invoke the existing low-level handlers directly. Rejected because it would keep old action names and hidden file input ownership in the presentational menu.

4. **Create tabs at document-open boundaries.**

   `New` and successful `Open...` flows must create and activate a new tab. The previously active tab remains open and unchanged. Direct filesystem open must bind the selected handle to the newly created document identity, not the previously active document.

   Alternative considered: import into the current tab and let users create tabs manually. Rejected because prior tab work established open/import flows as new-tab flows and because replacing the active document is a destructive surprise.

5. **Test at the owning seams.**

   Under `docs/testing.md`, presentational menu and modal rendering belong in the UI lane, while document action sequencing belongs in the application seam. Browser-only upload/download behavior and direct filesystem binding should be covered through existing workbench document action/controller tests where possible, with e2e reserved only for browser-only behavior that cannot be proven through the UI/application seams.

## Risks / Trade-offs

- **Risk: users may not understand that "keep linked" means future automatic writes.** -> Mitigation: modal copy explicitly says future changes save to the same file on the computer.
- **Risk: unsupported direct filesystem access could feel like a broken Open/Save action.** -> Mitigation: only the direct-file choice reports the existing unsupported-browser message; the copy/download choice remains available.
- **Risk: bindings could attach to the wrong tab after opening a direct file.** -> Mitigation: route binding through the new document identity created by the successful open flow and cover it in application tests.
- **Risk: test coverage keeps asserting removed menu items.** -> Mitigation: update the UI file-menu spec and workbench document action specs as part of implementation, and remove source-shape assertions tied to old command ids.
