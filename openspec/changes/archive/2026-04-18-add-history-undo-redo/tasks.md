## 1. History Cursor Helpers

- [x] 1.1 Add pure helpers for previous/next sketch history cursor resolution from an active `SketchSessionState`
- [x] 1.2 Add pure helpers for previous/next document history cursor resolution from a loaded `DocumentSnapshot`
- [x] 1.3 Add unit tests for sketch and document cursor helper boundary behavior

## 2. Editor Runtime Contract

- [x] 2.1 Add editor history events or explicit toolbar history branches for Undo and Redo
- [x] 2.2 Ensure the XState runtime accepts sketch cursor and undo/redo history events
- [x] 2.3 Keep document timeline cursor movement out of toolbar Undo/Redo
- [x] 2.4 Preserve sketch undo/redo in the editor runtime
- [x] 2.5 Add editor runtime tests for sketch undo/redo and idle document no-op behavior

## 3. Toolbar Integration

- [x] 3.1 Derive `canUndo` and `canRedo` from the active sketch or command-stack history context
- [x] 3.2 Disable unavailable Undo and Redo toolbar controls without dispatching unavailable mutations
- [x] 3.3 Route sketch toolbar Undo and Redo activations through the editor runtime and workbench command history through the tool bus
- [x] 3.4 Add toolbar or workbench tests for disabled and enabled history tool presentation

## 4. Sketch Undo/Redo Behavior

- [x] 4.1 Wire Undo to move the active sketch-local history cursor one step backward
- [x] 4.2 Wire Redo to move the active sketch-local history cursor one step forward
- [x] 4.3 Preserve sketch-local after-cursor item behavior when new sketch items are authored after rollback
- [x] 4.4 Add tests proving sketch undo/redo updates visible sketch definition and does not call document cursor mutation

## 5. Workbench Command Undo/Redo Behavior

- [x] 5.1 Wire idle part-mode Undo to apply supported command-stack inverse operations
- [x] 5.2 Wire idle part-mode Redo to reapply supported command-stack operations
- [x] 5.3 Keep unsupported modeling mutations from falling back to document timeline rollback
- [x] 5.4 Add tests proving idle editor history no longer moves the document timeline cursor

## 6. Verification

- [x] 6.1 Run `bun run test`
- [x] 6.2 Run `bun run lint`
