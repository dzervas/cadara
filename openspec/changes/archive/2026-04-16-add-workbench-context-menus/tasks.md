## 1. Shared Menu Foundation

- [x] 1.1 Add a reusable Mantine-backed workbench context-menu component with mouse and keyboard opening support.
- [x] 1.2 Add focused tests for context-menu item rendering, labels, disabled state, and danger styling.

## 2. Navigation Surface Menus

- [x] 2.1 Add Parts & Objects menu actions for placeholder Delete and Export status messages.
- [x] 2.2 Add Snapshot Reference and Document Diagnostic menu actions for target selection and placeholder inspection status messages.
- [x] 2.3 Add Feature Timeline/history menu actions for edit, placeholder suppress, roll cursor here, and delete.

## 3. Workbench Action Wiring

- [x] 3.1 Wire placeholder actions to inline workbench status messages.
- [x] 3.2 Wire feature cursor and feature delete actions through existing modeling service mutations and document refresh.
- [x] 3.3 Persist body/part rename actions through a modeling document mutation and operation history.

## 4. Verification

- [x] 4.1 Add or update component/workbench tests for the new menu surfaces and action wiring.
- [x] 4.2 Run `bun run test` and `bun run lint`.
