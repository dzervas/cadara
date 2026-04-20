## Why

The workbench currently has tool actions in the toolbar and object-scoped export in context menus, but no top-level document file affordance. Users need a compact CAD-style entry point to create a fresh document and import or export the current document without leaving the modeling workspace.

## What Changes

- Add a file button at the far left of the top toolbar.
- Open a workbench-styled menu from that button with New, Import, and Export actions.
- Wire New to create a fresh empty document through the existing document state boundary.
- Wire Import to load a selected cadara document JSON file into the current document state.
- Wire Export to download the current durable document JSON as a `.cadara` file.
- Add tests that cover the file menu interaction and the document import/export/new behavior.

## Capabilities

### New Capabilities
- `workbench-document-file-menu`: Defines the top-level toolbar file menu and document-level new/import/export flows.

### Modified Capabilities

## Impact

- Affects the top toolbar component and any workbench shell state needed to expose the menu.
- Affects document repository/modeling service boundaries where creating, replacing, or exporting the active document is not yet exposed.
- Adds focused unit/component coverage and an end-to-end test path for the user-facing behavior.
