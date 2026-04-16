## 1. Add split/delete-solid contract and validation

- [x] 1.1 Add or confirm split contract examples using explicit `targetBody` plus one supported split-tool participant family, and delete-solid examples using explicit `body` participants
- [x] 1.2 Add split/delete-solid validation coverage for required participants, accepted target kinds, supported split-tool families, and any first-slice body cardinality rules
- [x] 1.3 Update operation-history validation and fixtures so split/delete-solid create/update entries preserve participants and options
- [x] 1.4 Update modeling service normalization and snapshot hydration coverage for split/delete-solid advanced-solid definitions

## 2. Add split/delete-solid authoring and tool integration

- [x] 2.1 Add the split and delete-solid tool metadata and part-mode registration in the existing tool/feature registry path
- [x] 2.2 Add `src/domain/feature-authoring/features/split.ts` and `src/domain/feature-authoring/features/delete-solid.ts` with draft defaults, hydration, selection handling, preview labels, diagnostics, and draft-to-definition construction
- [x] 2.3 Add form schema fields for split target/tool selection and delete-solid body selection, plus diagnostics and any first-slice options
- [x] 2.4 Register the split/delete-solid authoring definitions and update registry tests so both are discoverable without feature-specific inspector branching

## 3. Implement modeling adapter behavior

- [x] 3.1 Add mock adapter handling so split/delete-solid preview and commit responses can be exercised by editor and service tests
- [x] 3.2 Add OCC adapter handling for the initial supported split path and delete-solid path
- [x] 3.3 Add explicit unsupported-case diagnostics for unsupported split-tool families, unsupported body combinations, unresolved topology, or other valid-but-unimplemented split/delete-solid cases
- [x] 3.4 Update render export, consumed-target tracking, invalid-reference reporting, and body lifecycle bookkeeping so split/delete-solid results update durable state consistently

## 4. Add focused automated coverage

- [x] 4.1 Add contract tests for split/delete-solid payload validation, operation-history persistence, and snapshot/edit hydration
- [x] 4.2 Add feature-authoring tests for split/delete-solid selection, diagnostics, form schema participant descriptors, and draft-to-definition construction
- [x] 4.3 Add adapter tests for supported split/delete-solid behavior and unsupported diagnostics without committed document mutation
- [x] 4.4 Add boundary tests or update existing boundary assertions to ensure split/delete-solid authoring and inspector code do not import OCC or kernel-specific modules

## 5. Add e2e feature-flow coverage

- [x] 5.1 Extend the shared feature workbench harness with helpers for body-target selection, split-tool selection, and post-operation body assertions
- [x] 5.2 Add Playwright e2e coverage for split and delete-solid that verifies preview readiness or expected diagnostics, commit, and resulting document/body state
- [x] 5.3 Run the targeted unit/integration tests and the split/delete-solid e2e flow, then update this task list with completed verification results
