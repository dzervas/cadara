## 1. Add mirror/transform contract and validation

- [x] 1.1 Add or confirm mirror/transform contract examples using explicit body participants, explicit reference participants, and typed first-slice options
- [x] 1.2 Add mirror/transform validation coverage for required body targets, accepted reference kinds, typed option validation, and first-slice scope restrictions
- [x] 1.3 Update operation-history validation and fixtures so mirror/transform create/update entries preserve participants, references, and options
- [x] 1.4 Update modeling service normalization and snapshot hydration coverage for mirror/transform advanced-solid definitions

## 2. Add mirror/transform authoring and tool integration

- [x] 2.1 Add the mirror and transform tool metadata and part-mode registration in the existing tool/feature registry path
- [x] 2.2 Add `src/domain/feature-authoring/features/mirror.ts` and `src/domain/feature-authoring/features/transform.ts` with draft defaults, hydration, selection handling, option patching, preview labels, diagnostics, and draft-to-definition construction
- [x] 2.3 Add form schema fields for body/reference selection, typed transform options, diagnostics, and any first-slice copy policy controls
- [x] 2.4 Register the mirror/transform authoring definitions and update registry tests so both are discoverable without feature-specific inspector branching

## 3. Implement modeling adapter behavior

- [x] 3.1 Add mock adapter handling so mirror/transform preview and commit responses can be exercised by editor and service tests
- [x] 3.2 Add OCC adapter handling for the initial supported mirror path and first supported transform path
- [x] 3.3 Add explicit unsupported-case diagnostics for unsupported reference families, unsupported option sets, unresolved topology, or other valid-but-unimplemented mirror/transform combinations
- [x] 3.4 Update render export, consumed-target tracking, invalid-reference reporting, and body lifecycle bookkeeping so mirror/transform results update durable state consistently

## 4. Add focused automated coverage

- [x] 4.1 Add contract tests for mirror/transform payload validation, operation-history persistence, and snapshot/edit hydration
- [x] 4.2 Add feature-authoring tests for mirror/transform selection, option handling, diagnostics, form schema participant descriptors, and draft-to-definition construction
- [x] 4.3 Add adapter tests for supported mirror/transform behavior and unsupported diagnostics without committed document mutation
- [x] 4.4 Add boundary tests or update existing boundary assertions to ensure mirror/transform authoring and inspector code do not import OCC or kernel-specific modules

## 5. Add e2e feature-flow coverage

- [x] 5.1 Extend the shared feature workbench harness with helpers for body-target selection, transform-reference selection, and post-operation body assertions
- [x] 5.2 Add Playwright e2e coverage for mirror and transform that verifies preview readiness or expected diagnostics, commit, and resulting document/body state
- [x] 5.3 Run the targeted unit/integration tests and the mirror/transform e2e flow, then update this task list with completed verification results

## Verification Results

- [x] `bun x vite-node src/contracts/modeling/advanced-solid.spec.ts`
- [x] `bun x vite-node src/contracts/modeling/operation-history.spec.ts`
- [x] `bun x vite-node src/contracts/shared/contract-examples.spec.ts`
- [x] `bun x vite-node src/domain/feature-authoring/registry.spec.ts`
- [x] `bun run test:editor-state-machine`
- [x] `bun run test:mock-kernel-contract`
- [x] `bun run test:occ-phase4`
- [x] `bun run test:occ-phase8`
- [x] `bun x playwright test e2e/feature-flow.spec.ts --grep "mirror|transform"`
- [x] `bun run build`
