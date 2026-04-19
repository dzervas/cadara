## Why

Sketch editing currently lacks a complete delete flow for selected geometry. Users need Delete/Backspace to remove selected sketch geometry, clean up dependent constraints, and rely on toolbar Undo to restore the full pre-delete sketch state.

## What Changes

- Add sketch-mode Delete and Backspace handling for selected editable sketch geometry.
- Remove any committed sketch constraint or dimension record that references deleted geometry as part of the same deletion operation.
- Record the geometry and dependent constraint removal as one undoable sketch-local history step.
- Restore deleted geometry and the removed constraints when toolbar Undo is activated while the sketch session is active.
- Add focused tests that validate deletion by keyboard shortcut and restoration through Undo.

## Capabilities

### New Capabilities

### Modified Capabilities
- `sketch-geometry-editing`: Selected editable sketch geometry can be deleted from an active sketch session with Delete or Backspace.
- `sketch-constraint-authoring`: Constraints and dimensions that reference deleted sketch geometry are removed with that geometry.
- `history-undo-redo`: Sketch-local undo restores geometry deletions and their dependent constraint removals atomically.

## Impact

- Affected areas likely include sketch session/domain mutation logic, selection state handling, keyboard shortcut routing, viewport/workbench delete dispatch, and sketch-local history integration.
- Tests should cover domain-level deletion semantics and the UI/action path for Delete/Backspace plus toolbar Undo.
- No new external dependencies or persistence format changes are expected beyond existing sketch history and authored sketch data contracts.
