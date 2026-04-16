## 1. Document Contract and Persistence

- [x] 1.1 Add a typed document variable record with stable id, name text, and value text to the modeling contract.
- [x] 1.2 Include ordered document variables in document snapshots and runtime snapshot schemas without changing snapshot reference records.
- [x] 1.3 Add persisted operation-history entries or equivalent document persistence plumbing for adding variables and updating variable name/value text.
- [x] 1.4 Update history replay so persisted variables are restored into rebuilt document snapshots without evaluating expressions.
- [x] 1.5 Add focused `bun:test` coverage for variable snapshot validation, persistence, and refresh replay.

## 2. Sidebar Variables UI

- [x] 2.1 Replace the visible Snapshot References sidebar section with a Variables section while preserving reference data for non-sidebar logic.
- [x] 2.2 Add an end-of-header add button that appends a new variable row with name and value text inputs.
- [x] 2.3 Implement value editing on double-click for existing variable rows and persist committed raw value text.
- [x] 2.4 Accept runtime/UI-only invalid variable state and render invalid value controls or rows with danger styling.
- [x] 2.5 Add focused component tests for rendering variables, adding a variable row, double-click value editing, and invalid styling.

## 3. Diagnostics Layout and Verification

- [x] 3.1 Constrain the Document Diagnostics section so its max height equals the current normal diagnostics height and overflow scrolls internally.
- [x] 3.2 Verify the sidebar still renders Parts & Objects and compact Document Diagnostics with no standard Snapshot References section.
- [x] 3.3 Run `bun run test`.
- [x] 3.4 Run `bun run lint`.
