## 1. Editor Selection Clear Event

- [x] 1.1 Add an explicit editor-machine event for clearing selection and hover state without changing active command/session ownership.
- [x] 1.2 Add reducer coverage proving the clear event removes selection and hover in idle, sketch, and active command states that should preserve their active interaction state.

## 2. Escape Routing

- [x] 2.1 Extend workbench Escape handling so selection clears only when no reference picker, active sketch tool, construction selection, or cancellable part command handles Escape first.
- [x] 2.2 Add shortcut/workbench interaction tests for Escape clearing selection when no tool is active and preserving existing higher-priority cancellation behavior.

## 3. Viewport Empty-Space Clicks

- [x] 3.1 Add a viewport deselect callback from `ThreeCadViewport` to `CadWorkbench` and dispatch the shared selection-clear event for empty primary-button canvas clicks.
- [x] 3.2 Ensure empty-space click deselection runs regardless of active tool state while target clicks continue through existing selection routing.
- [x] 3.3 Add focused viewport or interaction tests for empty-click deselection with no active tool, with an active tool, and with a resolved target.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
