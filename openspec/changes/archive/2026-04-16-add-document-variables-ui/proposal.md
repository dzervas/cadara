## Why

The workbench needs document-level variables so users can define reusable named values before expression evaluation is implemented. The left sidebar also needs to prioritize variables over low-level snapshot reference records and keep document diagnostics compact.

## What Changes

- Add a document-level variables model with persisted variable records containing a stable id, name, and raw text value.
- Add a Variables section to the left sidebar in place of the current visible Snapshot References section.
- Add a plus/add control at the end of the Variables section header; activating it appends a new editable variable row with name and value text inputs.
- Allow double-clicking a variable row to edit its value.
- Represent invalid variable value state as runtime/UI-only state, and render invalid values with a clear red border or background.
- Limit Document Diagnostics so its maximum height equals its current normal rendered height, allowing overflow to scroll within the diagnostics section.
- Do not implement expression validation, mathjs evaluation, or variable usage by feature parameters in this change.
- Do not remove or rename the underlying durable reference records or snapshot reference contract.

## Capabilities

### New Capabilities
- `document-variables`: Document-level variable persistence and sidebar authoring UI, excluding actual expression validation and variable usage evaluation.

### Modified Capabilities
- `feature-timeline-bar`: The sidebar non-feature section requirement changes from showing snapshot references to showing document variables while preserving objects and diagnostics.

## Impact

- Affected document contracts: modeling document snapshot types, runtime schemas, and operation-history persistence for variable add/update data.
- Affected UI: `FeatureSidebar` layout and sidebar tests for Variables and compact diagnostics behavior.
- Affected services/hooks: document state mutation path for adding and editing variables, without evaluating expressions.
- No new runtime dependency is required; future mathjs integration remains outside this change.
