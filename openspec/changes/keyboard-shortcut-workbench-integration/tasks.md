## 1. Provider Integration

- [x] 1.1 Install the shortcut provider within the workbench provider tree
- [x] 1.2 Add command execution access to editor dispatch, editor state, and tool actions
- [x] 1.3 Add `shortcut` to tool trigger metadata and update affected types/tests

## 2. Core Commands

- [x] 2.1 Wire Undo and Redo shortcuts to existing active history behavior
- [x] 2.2 Wire Escape to existing cancelable interaction resolution without finishing sketches
- [x] 2.3 Wire Delete and Backspace to eligible annotation deletion while preserving text-editing behavior
- [x] 2.4 Wire explicit Finish Sketch shortcut behavior

## 3. Tool Activation Defaults

- [x] 3.1 Register sketch-mode default shortcuts for Line, Rectangle, Circle, Dimension, and Construction
- [x] 3.2 Register part-mode default shortcuts for high-value feature tools such as Extrude
- [x] 3.3 Ensure disabled or out-of-scope tool commands do not execute

## 4. Handler Migration And Tests

- [x] 4.1 Remove or delegate superseded one-off workbench `Escape`, `Delete`, and `Backspace` listeners
- [x] 4.2 Add workbench tests for shortcut execution, text input guards, modes, and `shortcut` source metadata

## 5. Verification

- [x] 5.1 Run `bun run test`
- [x] 5.2 Run `bun run lint`
