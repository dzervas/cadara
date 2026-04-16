## 1. Add sweep contract and validation

- [x] 1.1 Add or confirm sweep contract examples using role-specific `profile`, `path`, optional `guideCurve`, and `targetBody` participants
- [x] 1.2 Add sweep-specific validation coverage for required participants, accepted target kinds, path cardinality, operation intent, and target-body requirements for boolean modes
- [x] 1.3 Update operation-history validation and fixtures so sweep create/update entries preserve participant roles and operation intent
- [x] 1.4 Update modeling service normalization and snapshot hydration coverage for sweep advanced-solid definitions

## 2. Add sweep authoring and tool integration

- [x] 2.1 Add the sweep tool metadata and part-mode registration in the existing tool/feature registry path
- [x] 2.2 Add `src/domain/feature-authoring/features/sweep.ts` with draft defaults, hydration, patching, selection application, preview labels, diagnostics, and draft-to-definition construction
- [x] 2.3 Add sweep form schema fields for profile selection, path selection, operation intent, boolean target bodies, diagnostics, and any initial sweep options
- [x] 2.4 Register the sweep authoring definition and update registry tests so sweep is discoverable without feature-specific inspector branching

## 3. Implement modeling adapter behavior

- [x] 3.1 Add mock adapter handling so sweep preview/commit responses can be exercised by editor and service tests
- [x] 3.2 Add OCC adapter handling for the initial supported sweep shape using one closed profile target and one durable path target
- [x] 3.3 Add explicit unsupported-case diagnostics for guide curves, unsupported path target kinds, unsupported profile/path orientation, unsupported boolean composition, or other valid-but-unimplemented sweep combinations
- [x] 3.4 Update render export, consumed-target tracking, and invalid-reference reporting so sweep results bind back to durable feature and participant targets consistently

## 4. Add focused automated coverage

- [x] 4.1 Add contract tests for sweep payload validation, operation-history persistence, and snapshot/edit hydration
- [x] 4.2 Add feature-authoring tests for sweep selection, field patching, diagnostics, form schema participant descriptors, and draft-to-definition construction
- [x] 4.3 Add adapter tests for supported sweep preview/commit and unsupported sweep diagnostics without committed document mutation
- [x] 4.4 Add boundary tests or update existing boundary assertions to ensure sweep authoring and inspector code do not import OCC or kernel-specific modules

## 5. Add e2e feature-flow coverage

- [x] 5.1 Extend the shared feature workbench harness to activate sweep and select profile/path participants without brittle topology assumptions where possible
- [x] 5.2 Add a Playwright e2e test that creates or reuses a suitable fixture, activates sweep, selects the profile and path, verifies preview readiness or expected diagnostics, commits sweep, and verifies the resulting document/timeline/geometry state
- [x] 5.3 Run the targeted unit/integration tests and the sweep e2e flow, then update this task list with completed verification results
