## Why

In sketch edit mode, deleting a row from the sketch-local timeline currently reuses the live selection delete path. That appends a new `delete` authoring operation instead of removing the targeted authored operation, so the timeline grows when the user is trying to remove history and reference-image rows keep behaving like content deletes rather than row deletes.

## What Changes

- Add an explicit sketch-history delete flow for the sketch editor timeline context menu instead of routing that action through generic sketch annotation or geometry deletion.
- Remove the targeted sketch authoring operation row from the sketch definition and rebuild the visible sketch state from the remaining authoring operations.
- Preserve existing Delete and Backspace behavior for live sketch geometry, constraints, dimensions, annotations, and viewport-selected reference images outside the sketch-history context menu flow.
- Make sketch-history deletion of reference-image rows remove the targeted operation itself rather than appending a follow-up `delete` operation.
- Repair the sketch-local history cursor after row deletion so the timeline never points at a removed operation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sketch-authoring-operations`: Clarify that direct deletion of live sketch members still appends delete operations, while explicit deletion of a sketch-history operation removes the targeted authored row instead.
- `sketch-history-navigation`: Define sketch-local history delete behavior so timeline context-menu deletion removes the targeted operation row and repairs the local cursor.
- `reference-image-sketch-op`: Change sketch-history deletion of committed reference-image operations from append-delete-op semantics to direct operation removal.

## Impact

- Affected code is expected in the sketch history timeline context-menu wiring, editor state-machine event routing, sketch-session authoring-operation mutation helpers, reference-image operation handling, and focused Bun tests.
- No new dependency or durable schema migration is expected; this change alters how sketch-local history deletion mutates the in-memory and persisted authoring operation list.
