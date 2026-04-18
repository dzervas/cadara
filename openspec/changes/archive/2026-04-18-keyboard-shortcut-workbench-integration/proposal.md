## Why

After the shortcut foundation exists, the workbench needs to route real keyboard input through it so shortcuts trigger the same behavior as toolbar and editor interactions. This phase makes shortcuts operational while keeping customization and broad display work separate.

## What Changes

- Wire the shortcut provider into the workbench shell.
- Register and execute core editor commands for undo, redo, cancel, delete, search focus, and explicit Finish Sketch.
- Register core tool activation defaults for part and sketch modes.
- Migrate current one-off `Escape`, `Delete`, and `Backspace` workbench handlers into command-backed shortcut behavior.
- Ensure keyboard-triggered tools are observable through tool action metadata.

## Capabilities

### New Capabilities

- `keyboard-shortcut-workbench-integration`: Workbench keyboard execution for core editor actions, tool activation, modes, and existing key handlers.

### Modified Capabilities

- None.

## Impact

- Affected areas: `src/app/cad-workbench.tsx`, `src/hooks/`, `src/domain/tools/`, editor runtime dispatch wiring, toolbar history availability, and tests.
- `ToolSource` should include `shortcut` so subscribers can distinguish keyboard-triggered activations.
- No document persistence changes.
