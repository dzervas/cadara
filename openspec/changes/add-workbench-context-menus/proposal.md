## Why

Dense CAD navigation needs fast target-local commands without forcing every action through the toolbar or inspector. The current workbench has selectable object, reference, diagnostic, and feature-history rows, but right-click falls back to browser behavior or no behavior.

## What Changes

- Add a shared custom workbench context-menu component for row-level right-click actions.
- Apply context menus to Parts & Objects, Snapshot References, Document Diagnostics, and the bottom Feature Timeline/history.
- Wire real behavior where the workbench already supports it: feature edit, feature cursor rollback, feature delete, and target selection.
- Persist body/part rename actions through the modeling document and operation history.
- Surface placeholder actions through inline workbench status messages for object delete, object export, reference inspection, diagnostic inspection, and feature suppress.
- Preserve existing left-click selection, timeline double-click edit, cursor dragging, and compact dark workbench styling.

## Capabilities

### New Capabilities
- `workbench-context-menus`: Shared context-menu behavior and row actions for visible workbench navigation surfaces.

### Modified Capabilities

## Impact

- Affected code includes shared layout components, feature sidebar rows, feature timeline controls, and workbench action handlers.
- Uses existing Mantine menu styling and adds a focused body rename modeling mutation; no new dependencies are required.
