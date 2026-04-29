## Context

The sketch editor timeline is backed by `authoringOperations` and already supports cursor replay by reconstructing the flat sketch graph from surviving operations. The current Delete action in the sketch-local history menu does not have its own mutation path; it selects the row target and dispatches `sketch.annotationDeleteRequested`, which is the same path used for canvas and keyboard deletion of live sketch geometry and annotations.

That shared path is correct for deleting live sketch members because the current authoring model records those deletions as appended `delete` operations. It is incorrect for timeline row deletion because the user intent is to remove an authored history row, not to author a new delete row. The mismatch is most visible for reference-image operations, where deleting a history row currently appends another operation instead of removing the target row itself.

Assumption: this change only redefines Delete chosen from the sketch-local history context menu. Delete and Backspace shortcuts, and viewport-initiated deletion of live selected sketch content, keep their current semantics.

## Goals / Non-Goals

**Goals:**
- Give sketch-local history row deletion its own explicit mutation path.
- Remove the targeted authored operation from the sketch definition instead of appending a new delete operation.
- Rebuild sketch-local graph state and cursor position from the remaining operation sequence after deletion.
- Keep selection-based geometry, annotation, and viewport reference-image deletion behavior unchanged.
- Make reference-image history rows follow the same direct-removal semantics when deleted from sketch history.

**Non-Goals:**
- Change committed document-history delete behavior for sketches or features.
- Redefine Delete and Backspace shortcuts outside the sketch-history context-menu flow.
- Introduce a broader history compaction pass that removes every downstream no-op row after an earlier row is deleted.
- Redesign the sketch history UI beyond the targeted delete behavior.

## Decisions

### Use a dedicated sketch-history delete event

The sketch-local history menu should dispatch a dedicated editor event carrying the targeted operation id instead of selecting the row target and reusing `sketch.annotationDeleteRequested`.

Rationale: the same target kind can mean different things depending on how the action was invoked. Viewport selection delete should continue to mean "delete live content," while sketch-history menu delete should mean "remove this authored row." Making the source action explicit keeps those semantics separate and avoids special-casing selection state in the generic delete handler.

Alternative considered: infer history-row deletion from the current selection target kind inside `sketch.annotationDeleteRequested`. Rejected because viewport-selected `sketchOperation` targets, especially reference images, already use selection delete semantics that must remain intact.

### Remove the targeted operation row and replay surviving history

Implement a sketch-session helper that removes the targeted authoring operation from `fullDefinition.authoringOperations`, derives the next cursor target from the nearest surviving history item (or `empty`), and rebuilds the active sketch definition by replaying the remaining operation list through the existing history reconstruction path.

Rationale: the sketch editor already treats authoring operations as the source of truth for sketch-local history replay. Deleting a row should therefore be modeled as editing the operation list and then reconstructing the flat graph, not as a content delete disguised as another operation.

Alternative considered: translate row deletion into synthetic inverse operations. Rejected because it preserves the original row, grows history for a destructive edit, and recreates the behavior this change is meant to remove.

### Prune direct operation-id dependents for removed operation-owned state

When the deleted row is later referenced by `edited` or `removed` operation-id targets, drop follow-up rows whose only durable operation target points at the removed row. This primarily applies to reference-image edit/delete rows that only exist to mutate one earlier operation-owned state record.

Rationale: replaying a follow-up row whose only target operation no longer exists produces orphan history rows with no valid owner state. Pruning those direct dependents keeps reference-image history coherent without introducing a full semantic compaction pass for all downstream rows.

Alternative considered: keep every later row and allow replay no-ops. Rejected for operation-owned state because the timeline would continue showing edits or deletes for a row the user explicitly removed.

### Preserve existing live-member deletion semantics

Do not change `deleteSelectedSketchGeometry`, `deleteSelectedSketchAnnotation`, or Delete and Backspace shortcut routing for live selected sketch content.

Rationale: the current append-delete-operation model is still the correct durable representation for deleting live geometry, constraints, dimensions, annotations, and viewport-selected reference images while staying inside the sketch session.

Alternative considered: unify all sketch deletions under row-removal semantics. Rejected because live-member deletion and history-row deletion represent different user intents and different durable edits.

## Risks / Trade-offs

- [Risk] Removing an earlier authored row can leave later member-based operations with reduced or no visible effect. -> Mitigation: limit this change to direct row deletion semantics, replay surviving operations deterministically, and add regression tests for cursor and graph rebuild behavior.
- [Risk] Sketch-history menu behavior can diverge from shortcut delete behavior in ways that surprise users. -> Mitigation: scope the new behavior explicitly to the context-menu row action and cover both paths with tests.
- [Risk] Reference-image follow-up rows can become orphaned if operation-id dependencies are not handled. -> Mitigation: prune direct `edited` and `removed` dependents whose only durable operation target is the deleted row.
- [Risk] Cursor repair after row deletion can land on an invalid or surprising position. -> Mitigation: normalize to the nearest surviving predecessor when available, otherwise use the empty cursor, and verify with timeline tests.

## Migration Plan

No schema or storage migration is required. Existing sketches continue to load unchanged, and only future sketch-history row deletions rewrite the authored operation list by removing the targeted row and any directly dependent operation-owned follow-up rows.

Rollback is straightforward: restore the previous event routing and row-delete helper so sketch-history Delete once again delegates to the existing selection delete path.

## Open Questions

None beyond the stated assumption that shortcut and viewport delete semantics remain unchanged for this change.
