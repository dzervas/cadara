## 1. Contract and Resolution Design

- [x] 1.1 Define the canonical authored-value shape for eligible sketch dimension magnitude fields and document which dimension kinds/fields are in scope.
- [x] 1.2 Add a sketch-dimension value resolver that converts authored dimension values plus current document variables into a solver-ready sketch definition or modeling diagnostics.
- [x] 1.3 Add focused domain tests for literal values, expression values, invalid syntax, unresolved variables, non-finite results, positive-value validation, signed directional values, and angle conversion semantics.

## 2. Durable Sketch Schema and Normalization

- [x] 2.1 Update `DimensionDefinition` and related contract validation so eligible dimension magnitude fields preserve literal or expression authored sources.
- [x] 2.2 Normalize legacy numeric dimension payloads into literal authored values while continuing to reject malformed dimension records.
- [x] 2.3 Verify operation history, save/restore, undo/redo, and document replay preserve raw expression text and do not persist resolved values, ASTs, dependency graphs, or diagnostics.

## 3. Solver Boundary Integration

- [x] 3.1 Route sketch solve/rebuild paths through the sketch-dimension value resolver before invoking the sketch solver.
- [x] 3.2 Keep solver-facing types and solver-core implementation numeric-only after resolution.
- [x] 3.3 Add boundary tests proving expression-authored sketch dimensions reach the solver as concrete numbers and invalid expressions produce diagnostics without invoking numeric solve for the invalid definition.

## 4. Authoring and Annotation Editing

- [x] 4.1 Update sketch constraint authoring state and floating input descriptors so expression-capable dimension prompts preserve editable text/authored source instead of only `number | null`.
- [x] 4.2 Update dimension commit paths to store authored literal or expression sources while keeping target references and annotation placement unchanged.
- [x] 4.3 Update committed dimension annotation editing so reopening a dimension shows the authored source, saving updates the same durable dimension, and cancel leaves the existing dimension untouched.
- [x] 4.4 Cover authoring and annotation-edit flows with focused `bun:test` domain/component tests at the smallest stable seams.

## 5. Presentation and Diagnostics

- [x] 5.1 Replace numeric-only viewport floating inputs for expression-capable sketch dimension values with text-preserving inputs while retaining keyboard focus, min/value validation feedback, cancel, and save behavior.
- [x] 5.2 Update dimension label/annotation formatting to handle authored expressions and resolved values without hiding accessibility/debug metadata.
- [x] 5.3 Surface expression-resolution failures through existing modeling/editor diagnostic paths; never silently replace, delete, or ignore invalid expression-authored dimensions.

## 6. Verification

- [x] 6.1 Run focused tests for sketch dimension expression contracts, resolver, authoring/editing, and solver-boundary behavior.
- [x] 6.2 Run `bun run test:all`.
