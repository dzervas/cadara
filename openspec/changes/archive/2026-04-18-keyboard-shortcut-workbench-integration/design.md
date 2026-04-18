## Context

The foundation change defines commands and resolution. This phase installs that layer in the workbench and maps core commands to existing runtime behavior. Existing `Escape`, `Delete`, and `Backspace` handlers in the workbench are narrow and should be moved behind command execution so future shortcuts do not accumulate as unrelated `window` listeners.

## Goals / Non-Goals

**Goals:**

- Make keyboard shortcuts execute real workbench behavior.
- Preserve existing toolbar and action bus behavior.
- Keep `Escape` as cancel/close, not Finish Sketch.
- Use an explicit Finish Sketch shortcut, initially `shift+enter`.
- Prevent shortcuts from firing while users type in form/search inputs.

**Non-Goals:**

- No shortcut customization UI.
- No tooltip/context-menu shortcut display beyond what is needed for testing.
- No broad command coverage for every sidebar or timeline action yet.

## Decisions

- Install one workbench-level shortcut provider near the existing editor/tool providers so command execution can access editor state and `useToolActions`.
- Add `shortcut` to tool activation source metadata instead of bypassing the action bus. This keeps tool logging/subscribers consistent.
- Preserve mode filtering by reusing tool modes and command scopes. Sketch-only commands should be inactive outside sketch mode, and part-only commands should be inactive while editing a sketch.
- Route undo/redo through the existing history behavior rather than creating new mutation paths.
- Treat `Escape` as a command whose implementation is state-dependent: active reference picker, active sketch/tool interaction, or other cancelable state.

## Risks / Trade-offs

- Centralizing handlers may change subtle ordering of `Escape` and delete behavior → Add regression tests around current behavior before removing one-off handlers.
- Single-letter shortcuts can conflict with text entry → Keep guards strict and test search/input cases.
- Finish Sketch needs a visible affordance later → Use an explicit command now and leave display to the visibility phase.
