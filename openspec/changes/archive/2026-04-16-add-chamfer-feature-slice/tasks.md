## 1. Add chamfer contract and validation

- [x] 1.1 Add or confirm chamfer contract examples using role-specific `edge` participants and a positive constant-distance option
- [x] 1.2 Add chamfer-specific validation coverage for required edge participants, accepted target kinds, edge cardinality, and distance validity
- [x] 1.3 Update operation-history validation and fixtures so chamfer create/update entries preserve edge participant roles and distance options
- [x] 1.4 Update modeling service normalization and snapshot hydration coverage for chamfer advanced-solid definitions

## 2. Add chamfer authoring and tool integration

- [x] 2.1 Add the chamfer tool metadata and part-mode registration in the existing tool/feature registry path
- [x] 2.2 Add `src/domain/feature-authoring/features/chamfer.ts` with draft defaults, hydration, patching, edge selection, preview labels, diagnostics, and draft-to-definition construction
- [x] 2.3 Add chamfer form schema fields for edge selection, distance entry, diagnostics, and any initial variant metadata needed for future expansion
- [x] 2.4 Register the chamfer authoring definition and update registry tests so chamfer is discoverable without feature-specific inspector branching

## 3. Implement modeling adapter behavior

- [x] 3.1 Add mock adapter handling so chamfer preview/commit responses can be exercised by editor and service tests
- [x] 3.2 Add OCC adapter handling for the initial supported constant-distance chamfer on one or more durable body edges
- [x] 3.3 Add explicit unsupported-case diagnostics for unresolved edges, unsupported topology combinations, unsupported chamfer variants, or kernel build failures
- [x] 3.4 Update render export, consumed-target tracking, and invalid-reference reporting so chamfer results bind back to durable feature and edge targets consistently

## 4. Add focused automated coverage

- [x] 4.1 Add contract tests for chamfer payload validation, operation-history persistence, and snapshot/edit hydration
- [x] 4.2 Add feature-authoring tests for chamfer selection, distance patching, diagnostics, form schema participant descriptors, and draft-to-definition construction
- [x] 4.3 Add adapter tests for supported chamfer preview/commit and unsupported chamfer diagnostics without committed document mutation
- [x] 4.4 Add boundary tests or update existing boundary assertions to ensure chamfer authoring and inspector code do not import OCC or kernel-specific modules

## 5. Add e2e feature-flow coverage

- [x] 5.1 Extend the shared feature workbench harness to activate chamfer and select durable edge participants without brittle topology assumptions where possible
- [x] 5.2 Add a Playwright e2e test that creates or reuses a suitable base solid, activates chamfer, selects one or more edges, sets a distance, verifies preview readiness or expected diagnostics, commits chamfer, and verifies the resulting document/timeline/geometry state
- [x] 5.3 Run the targeted unit/integration tests and the chamfer e2e flow, then update this task list with completed verification results
