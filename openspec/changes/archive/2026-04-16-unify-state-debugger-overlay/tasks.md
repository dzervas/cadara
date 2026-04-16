## 1. Debugger Component

- [x] 1.1 Create a presentational unified state debugger component for the bottom-left viewport overlay.
- [x] 1.2 Move the existing bottom-left machine, command, selection, revision, diagnostics, sketch, feature session, and selection detail rows into the new component.
- [x] 1.3 Add active mode, preview state, selection filter label, selection requirement descriptions, and selection requirement slot counts to the debugger display model.
- [x] 1.4 Add local collapse and expand behavior that hides detailed rows without dispatching editor or modeling actions.

## 2. Layout Cleanup

- [x] 2.1 Replace the inline bottom-left debug panel in `CadWorkbench` with the unified state debugger component.
- [x] 2.2 Remove active mode and selection filter readouts from the feature tree header while preserving feature tree selection and visibility controls.
- [x] 2.3 Remove the feature sidebar editor session footer while preserving parts, objects, references, and document diagnostics sections.
- [x] 2.4 Remove redundant debugger-only contract and revision readouts from the feature inspector header while preserving the feature form, diagnostics, commit control, and cancel control.

## 3. Verification

- [x] 3.1 Add or update tests for debugger expanded content, filter requirement rendering, and collapsed state behavior.
- [x] 3.2 Add or update tests or e2e assertions confirming the removed sidebar and inspector readouts are no longer duplicated.
- [x] 3.3 Run the relevant TypeScript, unit, and UI verification commands for the changed components.
