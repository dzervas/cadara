## Why

Committed document history already supports double-click reentry and partial context-menu actions, but the action set is not fully specified for sketch and feature entries. Users need one predictable history-row menu for editing, deleting, rolling to a specific entry, and jumping back to the end of applied history without relying on drag or double-click-only affordances.

## What Changes

- Finalize the committed document history context menu for sketch and feature entries around `Edit`, `Rename`, `Roll History Here`, `Roll To End`, and `Delete`.
- Define `Edit` as invoking the same reopen behavior and rollback lifecycle as double-clicking the same history entry.
- Define `Roll History Here` as moving the document cursor to the position immediately after the clicked history entry.
- Add `Roll To End` as a history-row shortcut that moves the document cursor to the current authored-history tail, and disable it when the cursor is already at the end position.
- Preserve feature-only actions such as `Suppress` for committed feature entries without requiring separate item rendering paths for sketch entries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workbench-context-menus`: document history row menus need an explicit action set and disabled-state contract for sketch and feature entries.
- `feature-timeline-bar`: the bottom history bar needs menu parity for edit and cursor actions in addition to the existing rename/delete behavior.
- `workbench-in-place-editing`: context-menu `Edit` needs to reuse the same reopen and rollback flow as double-click for committed sketch and feature entries.

## Impact

- Affected areas likely include [src/components/layout/feature-timeline-bar.tsx](/app/src/components/layout/feature-timeline-bar.tsx), the shared workbench context-menu definitions, history cursor helpers, workbench history routing, and focused component/editor tests.
- No new dependencies are expected.
- Existing rename, delete, drag-reorder, selection, and double-click reopen behavior should be preserved while the history menu contract becomes more explicit.
