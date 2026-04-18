## 1. Cursor Context

- [x] 1.1 Add a document-history helper that returns the cursor immediately before a target sketch or feature history item, including `empty` for the first item.
- [x] 1.2 Add editor-runtime state for edit-session cursor context: target item, rollback cursor, and restore cursor captured at edit entry.
- [x] 1.3 Add unit coverage for rollback cursor calculation across feature targets, sketch targets, first-item targets, and missing targets.

## 2. Edit Entry Lifecycle

- [x] 2.1 Update feature edit re-entry to move the document cursor to the rollback cursor before hydrating the feature edit session.
- [x] 2.2 Update committed sketch re-entry to move the document cursor to the rollback cursor before opening the sketch edit session.
- [x] 2.3 Ensure preview evaluation and sketch reference projection are emitted only after rollback cursor acceptance and snapshot refresh.
- [x] 2.4 Add editor-runtime tests for entering feature edit and sketch edit from both tail and non-tail document cursors.

## 3. Edit Exit Lifecycle

- [x] 3.1 Restore the captured entry cursor after feature edit cancel.
- [x] 3.2 Restore the captured entry cursor after successful feature edit commit.
- [x] 3.3 Restore the captured entry cursor after sketch abort.
- [x] 3.4 Restore the captured entry cursor after successful finish sketch.
- [x] 3.5 Add tests proving restore returns to the captured non-tail cursor instead of the history tail.

## 4. Preview And Viewport Behavior

- [x] 4.1 Verify feature edit previews render against the rolled-back committed scene while later authored history remains excluded.
- [x] 4.2 Verify sketch edit sessions keep sketch-local history active while the document cursor remains at the rollback position.
- [x] 4.3 Add focused viewport/renderable or workbench tests for the `sketch - extrude - sketch2 - revolve` editing scenario.

## 5. Verification

- [x] 5.1 Run `bun run test`.
- [x] 5.2 Run `bun run lint`.
