## Context

The workbench already exposes `presentation.documentHistory` as the mixed sketch/feature order shown in the bottom history bar. The document cursor can be dragged independently, and toolbar Undo/Redo already prioritizes sketch-local history, then the workbench command stack, then document cursor movement.

The modeling layer currently has feature-only reorder contracts and operation-history entries. Authored documents already persist a mixed `historyOrder`, so the missing contract is an authoring mutation that can move either a sketch or feature item and return a rebuilt snapshot.

## Goals / Non-Goals

**Goals:**

- Let users drag committed sketch and feature items in the history bar to reorder authored document history.
- Commit reorders as modeling mutations over durable sketch/feature item identities, not as presentational list edits.
- Record accepted reorder mutations in the workbench undo stack so Undo restores the previous order and Redo reapplies the next order.
- Persist/replay accepted mixed sketch/feature reorders through operation history and authored-document storage.
- Keep cursor dragging, item selection, item edit/reopen, and context menus behaviorally distinct from item reorder dragging.

**Non-Goals:**

- Reordering sketch-local history inside an active sketch edit session.
- Branching history, dependency graph repair UI, or automatic feature-definition retargeting beyond existing rebuild validation.
- Replacing the current document cursor undo/redo fallback.
- Adding a new drag-and-drop dependency when pointer events and existing timeline geometry are sufficient.

## Decisions

1. Introduce a document-history reorder mutation over mixed item identities.

   Add a contract shaped around `DocumentHistoryOrderEntry`: the moved item is a sketch or feature, and the insertion anchor is another sketch/feature item or `null` for tail insertion. This keeps the request aligned with the authored `historyOrder` instead of overloading the current feature-only `reorderFeature` API.

   Alternative considered: add `reorderSketch` and keep `reorderFeature` for features. That duplicates anchor logic and still leaves no shared contract for moves across sketch/feature boundaries.

2. Commit timeline item drag through Workbench -> editor/modeling mutation flow.

   `FeatureTimelineBar` should own only pointer state and proposed drop target calculation. It should call a workbench callback with the moved item and target anchor; the workbench should dispatch the mutation through the same revision-aware modeling path used for other document mutations.

   Alternative considered: mutating item order locally in the component. That would bypass revision conflicts, rebuild diagnostics, persistence, and undo stack ownership.

3. Store undo entries as previous and next document-history order snapshots.

   A reorder undo entry should contain the accepted previous and next `DocumentHistoryOrderEntry[]` plus a label. Undo applies the previous order, Redo applies the next order, and the entry only moves between stacks after the mutation is accepted.

   Alternative considered: store inverse drag coordinates or source/destination indices. Durable item identities survive render filtering and later labels; coordinates and indices are easier to invalidate after other mutations.

4. Treat cursor drag and item reorder as separate gestures.

   The cursor handle remains the only control that moves the document cursor. History item dragging starts from the item button after a movement threshold and targets item anchors, while click/double-click/context-menu behavior remains available for non-drag activation.

   Alternative considered: make all timeline dragging ambiguous and infer cursor-versus-item intent from location. That risks moving the cursor when the user meant to reorder, especially in the dense CAD timeline.

5. Replay mixed history-order mutations explicitly.

   Operation history should record the accepted document-history reorder request and replay it in sequence. Existing feature-only reorder history can remain supported as a compatibility path, but new mixed sketch/feature moves should use the generic entry.

   Alternative considered: rely only on authored-document persistence. Operation history is still used for export, migration, and compatibility replay, so leaving it feature-only would make refresh/export behavior diverge.

## Risks / Trade-offs

- Reordering can expose invalid dependencies during rebuild -> modeling adapters must reject invalid orders with diagnostics and leave the current order unchanged.
- Dragging dense icon-only items can conflict with click and context-menu interactions -> require a movement threshold and avoid committing on simple click, double-click, or right-click.
- Undoing a reorder after later mutations may conflict with the current revision -> keep the undo entry on the stack when the service rejects or conflicts, and surface existing diagnostics.
- Moving a cursor-relative item can leave the cursor pointing to the same durable item in a new index -> derive applied state from the cursor target after reorder and cover this with tests.

## Migration Plan

No persisted authored-document migration is expected because `historyOrder` already stores mixed sketch/feature entries. Operation-history schema support must be additive: existing `reorderFeature` entries continue to parse and replay, while new generic document-history reorder entries are accepted by the current schema version or a versioned migration if the runtime contract requires it.

## Open Questions

- Should the UI show a dedicated invalid-drop preview for dependency-breaking moves, or rely on rejection diagnostics after drop?
- Should a no-op drag that returns an item to its original effective position be ignored before calling the modeling service?
