## Why

Delete is exposed in navigation menus, but object deletion is still a placeholder and document history deletion is feature-specific. Users need one predictable delete action for parts, objects, sketches, and feature history rows without adding a separate implementation path for every authored feature or object type.

## What Changes

- Add a generic durable delete mutation that accepts a stable target or document history item identity and routes the deletion through shared document/history logic.
- Make Parts & Objects Delete use the generic deletion path instead of an inline placeholder.
- Make document history bar rows expose Rename and Delete context-menu actions consistently for sketches and features.
- Keep deletion undoable through the existing modeling mutation/history infrastructure and refresh the generated snapshot after accepted deletes.
- Preserve existing type-specific authoring behavior where needed for rebuilds, but do not require UI callers to choose a different delete implementation per feature or part type.

## Capabilities

### New Capabilities

### Modified Capabilities
- `durable-modeling-contract`: Generic document deletion becomes a first-class durable modeling mutation for supported parts/objects and document history items.
- `modeling-operation-history`: Accepted generic deletion mutations are persisted and replayed without feature-type-specific history entries.
- `workbench-context-menus`: Parts & Objects and document history context menus expose working Delete and Rename actions consistently.
- `feature-timeline-bar`: Document history rows expose context-menu parity for supported history item kinds while preserving existing selection, cursor, drag, and repair behavior.

## Impact

- Affected areas likely include modeling request/response contracts, runtime schemas, operation-history persistence/replay, mock and OpenCascade modeling adapters, document snapshot rebuilding, workbench mutation routing, sidebar and history bar context-menu item definitions, command ids/shortcut visibility, and focused component/domain tests.
- No new external dependencies are expected.
- Existing feature-specific delete behavior should be migrated or wrapped by the generic path rather than duplicated in each feature type.
