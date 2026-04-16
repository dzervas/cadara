## Why

Workbench state is currently duplicated across multiple UI surfaces, which makes command, selection, and authoring state harder to inspect while taking space away from primary CAD navigation. A single bottom-left debugger gives the team one predictable place for mode, selection filter, requirement, session, and snapshot diagnostics while allowing it to collapse when not needed.

## What Changes

- Replace the existing bottom-left viewport debug readout with a unified state debugger overlay.
- Move selection filter labels, selection requirements, target slot information, active command/mode, sketch state, feature edit state, preview/session state, selection details, revision, and diagnostic counts into the unified overlay.
- Make the unified state debugger collapsible and persist its expanded/collapsed state only as local UI state.
- Remove the feature sidebar's editor session footer.
- Remove active mode and selection filter readouts from the feature tree header.
- Remove redundant top-right/inspector state readouts that duplicate debugger-only state, while preserving functional feature editing controls.
- Keep feature tree, parts/object navigation, feature forms, tool dispatch, editor state machine, and modeling/session contracts separate.

## Capabilities

### New Capabilities
- `workbench-state-debugger`: Defines the unified, collapsible bottom-left workbench state debugger and which state surfaces it owns.

### Modified Capabilities

None.

## Impact

- Affected code: `src/app/cad-workbench.tsx`, `src/components/layout/feature-sidebar.tsx`, `src/components/layout/feature-inspector.tsx`, and any extracted debugger component under `src/components/`.
- Affected tests: focused component/domain tests or e2e assertions that currently expect sidebar/inspector debug text should be updated to assert the unified overlay instead.
- No modeling contract, kernel adapter, tool registry, or editor state machine API changes are expected.
