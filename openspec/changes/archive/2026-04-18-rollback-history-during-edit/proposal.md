## Why

Editing a committed feature or sketch currently needs a stable modeling basis: the document should be evaluated only up to the item being edited, while still showing that item's draft preview. Without a defined restore contract, entering edit mode can leave the document cursor at the wrong position after commit, cancel, or sketch abort flows, especially when the user started from an earlier timeline cursor instead of the tail.

## What Changes

- Entering edit mode for any committed feature rolls the document cursor back to the position immediately before that feature.
- Entering edit mode for any committed sketch rolls the document cursor back to the position immediately before that sketch.
- While editing, the target feature or sketch is represented through the existing draft/preview flow, and authored items after the rollback point are not applied to the committed scene.
- Exiting the edit session by commit, cancel, finish sketch, or abort sketch restores the document cursor to the exact position that was active before editing began.
- Restoring the cursor does not assume the tail; if the user began editing while the timeline cursor was after `sketch2`, it returns after `sketch2`.
- No persisted history entries are created for transient edit-entry rollback or edit-exit restoration by themselves.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `model-document-feature-cursor`: define transient edit-session cursor rollback and restoration semantics.
- `workbench-in-place-editing`: require feature and sketch edit re-entry to establish the rollback basis and restore cursor on exit.
- `sketch-history-navigation`: align reopened committed sketch editing with document cursor rollback while preserving sketch-local history behavior.
- `feature-preview-visibility`: clarify that preview overlays during edit sessions render against the rolled-back document basis, not against later applied history.

## Impact

- Affected editor/runtime orchestration for feature and sketch edit-session lifecycle.
- Affected modeling document cursor state and snapshot rebuild behavior.
- Affected preview request context for editing existing authored items.
- Tests should cover feature edit, sketch edit, cancel/abort, commit/finish, and non-tail starting cursor restoration.
