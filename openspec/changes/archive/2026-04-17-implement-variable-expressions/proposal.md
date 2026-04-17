## Why

Document variables currently persist authored name and value text, but they do not validate or evaluate expressions. Users need variable values to behave as real document parameters while preserving the raw authored expressions for persistence, replay, and future editing.

## What Changes

- Add math.js-backed evaluation for document variable expressions.
- Validate variable names and value expressions when variables are added or updated.
- Resolve expressions that reference other document variables, including dependent expressions such as `y = x + 50`.
- Preserve raw authored expression text in document variable records and operation history instead of storing calculated values.
- Report invalid variable state through runtime diagnostics without adding validation results or calculated values to persisted variable records.
- Add focused `bun:test` coverage for simple literals, nested/dependent expressions, invalid expressions, unresolved references, duplicate/invalid names, non-finite results, and cycles.

## Capabilities

### New Capabilities

### Modified Capabilities
- `document-variables`: Document-level variables become validated math expressions that can evaluate against other variables while continuing to persist raw expression text only.

## Impact

- Affected dependency set: add `mathjs` as the expression parser/evaluator.
- Affected domain code: variable validation/evaluation helpers and modeling service mutation paths for adding and updating variables.
- Affected adapters: mock and OpenCascade-backed document variable mutations must use the shared validation logic consistently.
- Affected persistence/contracts: document snapshots and operation history continue to store `valueText`; validation and computed results remain runtime-only.
- Affected tests: contract/domain tests covering expression evaluation, validation failures, dependency ordering, and persistence replay.
