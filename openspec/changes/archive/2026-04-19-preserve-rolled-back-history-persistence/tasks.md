## 1. Regression Coverage

- [x] 1.1 Add a failing repository-backed regression test for `sketch - extrude - sketch2 - revolve`, moving the document cursor to `sketch2`, reloading through a fresh modeling service with the same `DocumentRepository`, and asserting the restored document still contains `revolve`, preserves history order, preserves the cursor, and can move the cursor forward to `revolve`.
- [x] 1.2 Add focused contract coverage proving the authored document persisted after a cursor move contains all sketches, all features, complete `featureOrder`, complete `historyOrder`, and the requested cursor rather than only the applied snapshot prefix.

## 2. Persistence Source

- [x] 2.1 Add or expose a narrow authored-document export path that reads from complete kernel authoring state, including future items after the cursor, without adding derived render or presentation fields to the authored document.
- [x] 2.2 Update repository persistence in the modeling service to write accepted cursor moves and other accepted mutations from the complete authored-document source instead of an applied-only snapshot when the cursor is rolled back.
- [x] 2.3 Keep debug/export snapshot conversion behavior scoped so callers that intentionally serialize the exposed snapshot do not accidentally become the repository persistence source.

## 3. Restore And Cursor Behavior

- [x] 3.1 Ensure repository restore rebuilds only items through the persisted cursor while retaining all future authored sketches/features in the durable authoring state.
- [x] 3.2 Ensure next-cursor/redo navigation after restore resolves to future authored items after the cursor and does not recreate them with new IDs.
- [x] 3.3 Verify inserting a new feature while rolled back still inserts immediately after the cursor and preserves later authored items after the inserted feature.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
