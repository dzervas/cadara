## Context

Selection is editor-machine-owned state. Viewport target clicks currently dispatch `viewport.selectionRequested`, Escape routes through `editor.cancel`, and the viewport clears hover independently. There is already a `selection.clear` command definition, but selection clearing is described as implicit and has no shared event path.

The requested behavior touches keyboard command handling, viewport hit-testing, and editor-machine state transitions, so the design should keep deselection centralized rather than clearing React state locally.

## Goals / Non-Goals

**Goals:**

- Add one editor-owned deselection path that clears selection and related hover feedback consistently.
- Make Escape clear selection only after higher-priority cancel behavior declines to handle it.
- Make primary-button empty-space viewport clicks clear selection regardless of active tool state.
- Preserve target selection, annotation selection, sketch construction, and sketch pointer drawing behavior.

**Non-Goals:**

- Changing selection filtering, multi-select semantics, or reference picker selection rules.
- Adding new visual styling for deselected state.
- Changing toolbar tool activation, Finish Sketch behavior, or Delete/Backspace behavior.

## Decisions

1. Add an explicit editor event for clearing selection.

   Use an event such as `selection.cleared` or `selection.clearRequested` in the editor state machine. The reducer should clear `selection` and `hoverTarget`, update any preview label needed by the current mode, and leave active command/session state intact unless an existing cancel event already handles that state.

   Alternative considered: dispatch a fake selection request with `null`. Rejected because `viewport.selectionRequested` is typed around a concrete `PrimitiveRef` and selection filters expect a target.

2. Keep Escape priority in `getEscapeEvent`.

   Extend the Escape helper so it still returns, in order, reference picker cancellation, active sketch tool/construction clearing, active part command cancellation, and only then the new selection-clear event when selection is non-empty. This keeps Escape from unintentionally cancelling sketches or commands when a more specific interaction is active.

   Alternative considered: bind `selection.clear` as a separate shortcut with Escape. Rejected because Escape already resolves to `editor.cancel`, and the priority decision belongs in the existing cancel helper.

3. Treat empty-space viewport click as a viewport-level deselect signal.

   The viewport should detect primary-button clicks on the canvas that do not resolve a pick target and call a new prop such as `onDeselect`. This check should run independently of `shouldViewportClickRequestSelection(sketchSession?.activeTool)` so active tools do not suppress empty-space deselection. When a target is resolved, existing tool-state selection routing remains unchanged.

   Alternative considered: have the editor infer empty clicks from hover-cleared events. Rejected because hover can clear from pointer leave or hidden-target changes, neither of which is a user deselection gesture.

## Risks / Trade-offs

- Empty clicks during sketch drawing could clear a prior selection while also feeding the drawing pointer flow → Keep deselection isolated to selection state and do not prevent pointer construction events.
- Clearing hover with selection may remove useful hover feedback after an empty click → This matches the expected result of clicking empty space and avoids stale highlights.
- Feature/reference-picking flows may have field-owned selection state → Preserve reference picker cancellation priority and add tests around active-command state where practical.
