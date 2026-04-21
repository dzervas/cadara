## Why

The document history bar shows authored sketches and features in model order, but users cannot directly rearrange that order from the timeline. Reordering is an authoring mutation, so it needs the same undo/redo and persistence guarantees as other document mutations.

## What Changes

- Add drag-and-drop reordering for committed sketch and feature items in the document history bar.
- Commit accepted reorders through the editor/modeling mutation path so the authored document order and rebuilt snapshot stay authoritative.
- Push accepted history-order changes onto the workbench undo stack, with Undo and Redo restoring the previous and next authored order.
- Extend durable operation history where needed so sketch and feature history-order changes replay after refresh.
- Keep document cursor dragging separate from item reordering, and disable reorder commits while incompatible cursor or mutation work is pending.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `feature-timeline-bar`: document history items in the bottom bar can be dragged to reorder sketches and features.
- `sketch-history-navigation`: committed sketch items participate in document history reordering alongside feature items.
- `history-undo-redo`: accepted history-order mutations create undo/redo entries that restore prior and next item order.
- `modeling-operation-history`: persisted operation history records and replays document history-order mutations for both sketches and features.

## Impact

- Affects `FeatureTimelineBar` drag handling, context/selection affordances, and pending-state availability.
- Affects workbench undo/redo stack entry shapes and mutation dispatch around document history order.
- Affects modeling contracts, runtime schemas, operation-history persistence, mock/OCC adapter reorder handling, and document-history tests.
- Requires focused `bun:test` coverage for timeline drag reorder, undo/redo rollback, schema validation, replay, and cursor interaction edge cases.
