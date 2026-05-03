## Why

The workbench already has a visible tab-strip skeleton, but it is still pinned to one singleton document session, so switching tabs does not change the active Automerge-backed document or rebuild the model. That leaves multi-file work half-implemented right at the workbench/session boundary, which is exactly where this codebase has already been trying to establish explicit ownership and composition rules.

## What Changes

- Add a real multi-document workbench tab capability that:
  - persists the open-tab list and active tab across page reloads
  - keeps tab title and durable document name synchronized in both directions
  - shows per-tab `storageKind` state using the existing browser/filesystem/cloud model
  - switches the active workbench document session when the user activates a tab
  - rebuilds the editor/runtime snapshot for the newly active document through the existing kernel path
- Introduce an app-owned active-document session composition path so the workbench can mount a document-scoped modeling/editor session per active tab instead of mutating one singleton service instance in place.
- Extend the durable authored document contract with a document-level name field so tab rename is not UI-only metadata.
- Change document-opening flows so opening a local file or importing a document creates a new tab and activates it instead of replacing the currently active tab in place.
- **BREAKING** Replace the current replace-in-place import/open-document behavior with open-in-new-tab behavior.
- **BREAKING** Replace the current UI-only tab-title persistence model with a durable document-name contract; any older persisted tab metadata may be discarded rather than migrated.

## Capabilities

### New Capabilities
- `workbench-document-tabs`: Covers multi-document tab persistence, tab/document naming synchronization, per-tab storage indicators, and active-tab session switching through the workbench architecture.

### Modified Capabilities
- `authored-model-document`: Add a durable document-level name field to the canonical persisted authored document contract.
- `workbench-document-file-menu`: Change document import and local-open behavior so those actions create and activate a new tab instead of replacing the current active document in place.
- `local-file-system-document-sync`: Clarify that local file bindings and sync status are document-scoped and must surface correctly when different tabs bind different documents.
- `workbench-state-ownership`: Clarify that active-document session switching is an application-owned composition handoff and must not be implemented as shell-local repair logic over a singleton document session.
- `workbench-application-architecture`: Clarify that the workbench shell composes a document-scoped active session host rather than owning singleton document-session mutation logic inline.

## Impact

- Affected code: `src/App.tsx`, `src/app/workbench/cad-workbench.tsx`, workbench document controllers/actions, modeling-service bootstrap, editor provider composition, tab persistence, local-file sync integration, and authored-document contracts/schemas.
- Affected systems: workbench tab UX, active modeling/editor session ownership, document file actions, document naming, local file sync status presentation, and reload persistence.
- Expected outcome: a real multi-file workbench workflow that fits the current app-layer/session boundaries instead of adding another compatibility seam around the singleton active document.
