## Why

Selection currently has no explicit clear path from the most common CAD gestures: pressing Escape after tools are idle, or clicking empty viewport space. This leaves stale selection state visible after users have finished an interaction and makes deselection feel inconsistent with desktop CAD expectations.

## What Changes

- Make Escape clear the current selection when no higher-priority cancelable interaction or active tool is present.
- Make a primary-button click on empty viewport space clear the current selection even when a tool is active.
- Preserve existing Escape priority for reference pickers, active sketch tools, construction selection, and active part commands.
- Preserve existing target-pick and sketch pointer construction behavior for non-empty viewport clicks.
- Add focused tests for keyboard-driven and viewport empty-space deselection.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `keyboard-shortcut-workbench-integration`: Escape shall clear workbench selection when no active tool or cancelable interaction handles Escape first.
- `viewport-authoring-feedback`: Empty-space viewport clicks shall clear workbench selection independent of current tool state.

## Impact

- Affected areas: editor state-machine events/reducer, workbench shortcut cancel handling, viewport click handling, Three.js viewport props, and focused `bun:test` coverage.
- No new runtime dependencies or public API contracts are expected.
