## Context

The workbench already uses Mantine menu theme overrides and compact selectable rows in the left sidebar and bottom feature timeline. There is no shared context-menu component, and visible navigation rows currently rely on left click, double click, or dedicated icon buttons for actions.

## Goals / Non-Goals

**Goals:**

- Add one reusable right-click menu wrapper for workbench rows.
- Keep context-menu styling aligned with the existing Mantine dark workbench theme.
- Apply menus to Parts & Objects, Snapshot References, Document Diagnostics, and Feature Timeline/history.
- Wire existing feature edit, feature delete, feature cursor, and target selection actions.
- Persist body/part rename actions as document mutations.
- Show inline workbench status for placeholder actions.

**Non-Goals:**

- Adding object export serialization, object delete semantics, or feature suppression state.
- Restoring the old sidebar feature tree.
- Changing timeline drag, double-click edit, or selection behavior.

## Decisions

### Use Mantine Menu behind a shared wrapper

The shared component should wrap Mantine `Menu` and expose a small workbench-specific item model. This keeps styling and portal behavior consistent with the rest of the shell while avoiding repeated `contextmenu` event code in each row component.

### Keep actions owned by the workbench shell

Presentational rows should describe available menu items and call typed callbacks. `CadWorkbench` should own modeling-service mutations, document refresh, and inline status messages because it already has access to the snapshot revision, dispatch, and modeling service.

### Treat placeholders as selected actions

Placeholder actions should remain enabled and show inline status when selected. Disabled items are reserved for actions that are real but unavailable for the current row or selection state.

### Do not infer object delete from delete-solid

The Parts & Objects delete action remains a placeholder. Synthesizing a delete-solid feature would change modeling behavior and require user intent, feature naming, participant rules, and rollback semantics that are outside this UI interaction change.

### Persist body rename as a document mutation

Body labels already belong to durable body snapshot records, so body/part rename should use a narrow `renameBody` modeling mutation rather than a sidebar-only label override. The operation history stores accepted body rename requests so restored sessions rebuild the same object-tree labels.

## Risks / Trade-offs

- [Right-click wrappers can interfere with nested buttons] -> Keep the wrapper as a lightweight element around each row/control and preserve existing left-click handlers on the same child controls.
- [Feature delete can fail on stale revisions] -> Use the current snapshot revision and surface rejection diagnostics through the existing inline status pattern.
- [Keyboard context-menu support varies by focused element] -> Support `ContextMenu` and `Shift+F10` on focusable wrapped rows without changing broader keyboard navigation.
