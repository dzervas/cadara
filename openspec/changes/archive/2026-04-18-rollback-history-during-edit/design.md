## Context

Document history already has a durable cursor that controls which committed sketches and features are applied during rebuild. Feature edit sessions hydrate from committed feature snapshots and use the existing preview path, while sketch edit sessions reopen a committed sketch or selected plane and switch the timeline area into sketch-local history.

This change makes edit re-entry explicitly rollback-aware. Editing a committed item must use the document state immediately before that item as the modeling basis, while preserving the user-visible cursor position that existed before the edit started.

## Goals / Non-Goals

**Goals:**

- Capture the document cursor active at edit entry and restore it after every edit exit path.
- Move the document cursor to the position immediately before the committed feature or sketch being edited before showing the edit session.
- Keep the target feature or sketch visible through the existing draft/preview behavior while later authored items are excluded by the rolled-back cursor.
- Cover feature commit/cancel and sketch finish/abort flows, including sessions entered from a non-tail cursor.
- Avoid recording transient edit-entry rollback and edit-exit restore as user-authored modeling history.

**Non-Goals:**

- Redesign document history ordering, sketch-local history, or toolbar Undo/Redo.
- Change how feature definitions, sketch definitions, or preview renderables are authored.
- Add branching history semantics beyond the existing cursor and insertion rules.
- Make unsupported feature kinds editable.

## Decisions

1. Store an edit-session cursor context in editor runtime state.

   The runtime should carry the cursor that was active before edit entry, the rollback cursor immediately before the target item, and the target item identity. This belongs with editor session state because it is lifecycle state, not durable authored model content.

   Alternative considered: infer the restore cursor from the latest snapshot on exit. That fails when the original cursor was not the tail, because the runtime cannot distinguish "return to the user's original point" from "advance to the newest item".

2. Use existing document cursor movement semantics for rollback and restore.

   Entering edit mode should issue the same cursor mutation path used by timeline rollback, then refresh the snapshot before opening or previewing the edit session. Exiting should commit or cancel the edit flow, then move the cursor back to the stored restore cursor and refresh again.

   Alternative considered: render an editor-only filtered snapshot without moving the model cursor. That would duplicate rebuild filtering and risks previews running against a different basis than the viewport.

3. Calculate the rollback cursor from document history order, not from feature-only order.

   The target may be a sketch or a feature. The rollback cursor is the cursor for the history item immediately before the target item, or `empty` if the target is the first authored item.

   Alternative considered: use feature indices only. That would put sketch edits and features that depend on sketches on inconsistent bases.

4. Treat transient edit rollback/restoration as session orchestration, not durable authored operations.

   The user's authored document order and operation history should only change when they commit a feature or finish a sketch. Cursor moves made only to create the edit basis or restore the prior view should not appear as separate undoable authoring commands.

   Alternative considered: persist every cursor move exactly like manual timeline cursor changes. That would make edit re-entry pollute history replay and undo expectations.

## Risks / Trade-offs

- Cursor restore can conflict with a changed document revision -> use the same revision conflict diagnostics as document cursor moves and keep the user in a coherent editor state if restore fails.
- Commit may change the edited item's revision or identity ordering -> restore by the stored durable cursor target, not by an index captured before the mutation.
- Editing the first history item requires an `empty` rollback cursor -> include explicit tests because this is an easy off-by-one case.
- Preview requests could race with rollback snapshot refresh -> emit previews only after the rollback cursor move is accepted and the refreshed snapshot is loaded.

## Migration Plan

No data migration is required. Existing documents already contain valid document-history items and cursors. Implementation should add tests around editor-runtime transitions and modeling cursor behavior, then wire the runtime effects through the existing modeling service APIs.

## Open Questions

- Should manual timeline cursor dragging be disabled while an edit-session rollback context is active, or should it be allowed but still restore the original entry cursor on exit?
