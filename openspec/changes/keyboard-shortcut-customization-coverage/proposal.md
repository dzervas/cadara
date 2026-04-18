## Why

Once shortcuts execute and are visible, users need profile-level control over their preferred bindings and broader coverage across non-toolbar workbench actions. This phase completes the end-to-end shortcut system by adding customization, persistence boundaries, generated reference surfaces, and more command coverage.

## What Changes

- Add a user-profile shortcut repository boundary with an initial local implementation.
- Add shortcut customization UI for remapping, disabling, resetting, and recording chord or sequence shortcuts.
- Add conflict validation before saving profile overrides.
- Expand command coverage for context menu, sidebar, timeline, viewport, and selection actions.
- Add a generated shortcut reference or command list from the registry and effective keymap.

## Capabilities

### New Capabilities

- `keyboard-shortcut-customization-coverage`: Profile-level shortcut customization, persistence boundary, generated reference UI, and expanded workbench command coverage.

### Modified Capabilities

- None.

## Impact

- Affected areas: settings/profile boundary, shortcut provider state, Mantine UI components for customization/reference surfaces, context menu command definitions, viewport command definitions, tests.
- No document schema or modeling history changes; shortcut preferences are user-profile data.
