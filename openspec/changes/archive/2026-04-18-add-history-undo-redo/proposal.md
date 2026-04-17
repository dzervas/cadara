## Why

The toolbar already exposes Undo and Redo controls, but it must not treat document timeline rollback as general command undo. A variable edit should undo by restoring the previous variable value, while the timeline cursor should remain a separate CAD rollback control.

## What Changes

- Add undo/redo behavior for the toolbar history tools.
- In sketch edit mode, undo/redo steps the active sketch-local history cursor backward or forward across authored sketch entities, constraints, and dimensions.
- Outside sketch mode, undo/redo uses a workbench command stack for supported mutations instead of moving the document timeline cursor.
- Add command-stack undo/redo support for document variable edits.
- Keep feature-form draft undo/redo and unsupported modeling mutation inverses out of scope for this change.
- Preserve CAD timeline rollback as a separate bottom-timeline cursor behavior.

## Capabilities

### New Capabilities
- `history-undo-redo`: Defines toolbar undo/redo behavior for sketch-local draft history and supported workbench command history.

### Modified Capabilities
- None.

## Impact

- Affected specs: new `history-undo-redo` capability.
- Affected code areas: editor state machine and XState runtime event handling, toolbar tool action routing, sketch history cursor helpers, workbench command history handling, variable mutation flow, and focused `bun:test` coverage.
- No new runtime dependencies are expected.
- No breaking changes to modeling contracts are expected.
