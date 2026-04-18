## Why

Shortcuts are only useful when users can discover them where actions already appear. This phase makes the effective keymap visible in tooltips, dropdowns, search results, and context menus without hard-coding shortcut labels into descriptive copy.

## What Changes

- Add shared shortcut hint rendering driven by command ids and the effective keymap.
- Show shortcuts in toolbar tooltips, dropdown menu rows, and search results.
- Add optional command ids to workbench context menu entries and show matching shortcuts on the right side of menu rows.
- Ensure unassigned or disabled shortcuts do not display stale default hints.

## Capabilities

### New Capabilities

- `keyboard-shortcut-visibility`: Shortcut display in discovery surfaces using command ids and effective keymap formatting.

### Modified Capabilities

- None.

## Impact

- Affected areas: toolbar tooltip/button components, dropdown button, workspace toolbar search results, workbench context menu, sidebar/timeline menu item definitions, and presentation tests.
- No shortcut behavior changes are required beyond consuming the effective keymap.
