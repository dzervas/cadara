## 1. Sketch History Delete Routing

- [x] 1.1 Add a dedicated sketch-history delete event from the sketch editor timeline context menu instead of routing that menu action through `sketch.annotationDeleteRequested`.
- [x] 1.2 Update sketch timeline component coverage to assert that row Delete invokes the explicit history-delete path and no longer depends on generic live-selection deletion.

## 2. Sketch Session Operation Removal

- [x] 2.1 Implement a sketch-session helper that removes a targeted authoring operation, repairs the sketch-history cursor, and rebuilds the active sketch definition from the surviving operation list.
- [x] 2.2 Prune direct operation-id-dependent follow-up rows for removed operation-owned state so reference-image edit/delete rows do not survive without their owning operation.
- [x] 2.3 Wire the new helper through the editor state machine while preserving current Delete and Backspace behavior for live sketch geometry, annotations, and viewport-selected reference images.

## 3. Regression Coverage

- [x] 3.1 Add domain tests for deleting a sketch-history operation row, deleting an existing delete row, and cursor repair after row removal.
- [x] 3.2 Add reference-image tests covering sketch-history deletion of one image row without appending a new delete operation or disturbing other images.
- [x] 3.3 Update UI and state-machine tests to cover the distinct semantics between sketch-history row deletion and live selection deletion.

## 4. Verification

- [x] 4.1 Run the focused Bun test suites for sketch history, reference-image operations, and timeline context-menu behavior.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
