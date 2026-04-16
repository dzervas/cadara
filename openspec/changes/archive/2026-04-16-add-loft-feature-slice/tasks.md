## 1. Add loft contract and validation

- [x] 1.1 Add or confirm loft contract examples using ordered `profile` participants, optional `guideCurve` participants, and any supported operation intent or target-body participants
- [x] 1.2 Add loft-specific validation coverage for minimum profile count, preserved section order, accepted target kinds, guide-curve handling, and target-body requirements for any supported boolean modes
- [x] 1.3 Update operation-history validation and fixtures so loft create/update entries preserve ordered profile participants and any committed guide curves or operation intent
- [x] 1.4 Update modeling service normalization and snapshot hydration coverage for loft advanced-solid definitions

## 2. Add loft authoring and tool integration

- [x] 2.1 Add the loft tool metadata and part-mode registration in the existing tool/feature registry path
- [x] 2.2 Add `src/domain/feature-authoring/features/loft.ts` with draft defaults, hydration, ordered profile patching, optional guide-curve handling, preview labels, diagnostics, and draft-to-definition construction
- [x] 2.3 Add loft form schema fields for ordered profile selection, any explicit reordering controls, optional guide-curve input, diagnostics, and supported operation intent fields
- [x] 2.4 Register the loft authoring definition and update registry tests so loft is discoverable without feature-specific inspector branching

## 3. Implement modeling adapter behavior

- [x] 3.1 Add mock adapter handling so loft preview/commit responses can be exercised by editor and service tests
- [x] 3.2 Add OCC adapter handling for the initial supported loft shape using two or more compatible ordered profile sections
- [x] 3.3 Add explicit unsupported-case diagnostics for guide curves, incompatible section combinations, unsupported boolean composition, unresolved topology, or other valid-but-unimplemented loft combinations
- [x] 3.4 Update render export, consumed-target tracking, and invalid-reference reporting so loft results bind back to durable feature and participant targets consistently

## 4. Add focused automated coverage

- [x] 4.1 Add contract tests for loft payload validation, ordered-section persistence, operation-history persistence, and snapshot/edit hydration
- [x] 4.2 Add feature-authoring tests for loft section selection, section reordering, diagnostics, form schema participant descriptors, and draft-to-definition construction
- [x] 4.3 Add adapter tests for supported loft preview/commit and unsupported loft diagnostics without committed document mutation
- [x] 4.4 Add boundary tests or update existing boundary assertions to ensure loft authoring and inspector code do not import OCC or kernel-specific modules

## 5. Add e2e feature-flow coverage

- [x] 5.1 Extend the shared feature workbench harness to build a suitable multi-profile fixture and activate loft with ordered profile selection
- [x] 5.2 Add a Playwright e2e test that creates or reuses a loft-ready fixture, activates loft, selects at least two profiles in order, verifies preview readiness or expected diagnostics, commits loft, and verifies the resulting document/timeline/geometry state
- [x] 5.3 Run the targeted unit/integration tests and the loft e2e flow, then update this task list with completed verification results

## Verification Results

- `bun x vite-node src/contracts/modeling/advanced-solid.spec.ts`
- `bun run test:contract-examples`
- `bun x vite-node src/contracts/modeling/operation-history.spec.ts`
- `bun x vite-node src/domain/feature-authoring/registry.spec.ts`
- `bun x vite-node src/domain/modeling/mock-kernel-adapter.spec.ts`
- `bun x vite-node src/domain/modeling/occ/features.spec.ts`
- `bun run test:occ-phase8`
- `bun x vite-node src/components/layout/feature-inspector.spec.tsx`
- `bun x vite-node src/components/layout/workspace-toolbar.spec.tsx`
- `bun run test:e2e -- --grep "loft previews and commits with ordered profile selection"`

## Notes

- `bun x tsc -p tsconfig.app.json --noEmit` still reports pre-existing unrelated errors under `src/contracts/sketch/solver-core.ts` and `src/domain/solver/mock-sketch-solver-adapter.ts`.
