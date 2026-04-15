## Why

The workbench already has a centralized Mantine theme, but the app still mixes that theme with many hardcoded color literals in shell components, overlays, and utility styling. As long as those colors stay duplicated outside Mantine, the UI keeps drifting, tooltip contrast remains fragile, and `Finish Sketch` cannot stand out as the one obvious success action for exiting sketch mode.

## What Changes

- Make Mantine colors the only source of truth for app-authored presentation colors by replacing hardcoded color literals and ad hoc shell color variables with centralized Mantine theme tokens.
- Update workbench shell surfaces, overlays, selection/active treatments, and form-like controls to read from the Mantine theme rather than from bespoke blue-tinted RGBA values or component-local color decisions.
- Make toolbar tooltips readable in the dark workbench by styling the tooltip surface and text hierarchy together from Mantine theme values instead of assuming the default tooltip palette will match the custom shell.
- Give `Finish Sketch` an explicit success-green treatment while a sketch session is active so the exit path is visually obvious without changing tool ids, layout, or action contracts.
- Add or update focused UI tests around theme-token usage, tooltip readability, and the sketch-exit affordance so future changes do not reintroduce custom color drift.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `workbench-ui-foundation`: tighten the shell requirement so app-authored presentation colors come from centralized Mantine theme tokens only, including toolbar buttons, tooltips, overlays, panels, and semantic actions such as `Finish Sketch`.

## Impact

- Affected code in the centralized Mantine theme module, global CSS, workbench shell components, and viewport-adjacent overlay presentation components that currently embed custom color literals.
- Affected tests for toolbar rendering, tooltip presentation, and mode-aware workbench UI states.
- No domain contract, tool registry id, or action bus changes are required.
