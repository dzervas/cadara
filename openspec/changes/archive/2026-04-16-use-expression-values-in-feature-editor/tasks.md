## 1. Authored Value Contract

- [x] 1.1 Add shared authored-value types and helpers for literal and expression sources.
- [x] 1.2 Add value-kind descriptors for finite numbers, positive numbers, integers, booleans, strings, enum strings, and angles.
- [x] 1.3 Add runtime schemas for authored-value wrappers and focused tests for valid wrappers, invalid wrappers, and unsupported expression fields.
- [x] 1.4 Add legacy literal normalization for supported pre-expression feature payloads and tests proving canonical wrappers are produced.

## 2. Expression Resolution Boundary

- [x] 2.1 Create a shared feature value expression resolver that evaluates expression sources against current document variable results and math.js.
- [x] 2.2 Validate resolver results through value-kind descriptors and return structured diagnostics for syntax, unresolved symbols, type mismatches, non-finite numbers, positivity failures, integer failures, and enum failures.
- [x] 2.3 Add tests proving literal sources pass through, expression sources resolve, invalid expressions reject before execution, and computed values are not persisted.
- [x] 2.4 Add tests proving valid variable changes recompute dependent feature values and invalid dependent results surface rebuild diagnostics without rewriting authored expressions.

## 3. Feature Authoring and Form Schema

- [x] 3.1 Update feature editor form schema types so non-reference fields can declare expression-capable authored values and value-kind metadata.
- [x] 3.2 Update form adapter behavior so expression-capable non-reference patches preserve raw expression text instead of always coercing through numeric parsing.
- [x] 3.3 Update feature draft types and current feature authoring definitions to preserve authored values for eligible non-reference editor fields.
- [x] 3.4 Ensure reference pickers, reference collections, durable refs, IDs, feature discriminants, and selection targets remain unwrapped and non-expression-capable.
- [x] 3.5 Add feature authoring and form adapter tests for literal values, expression text, boolean/enum-like authored values where present, and reference-field exclusion.

## 4. Modeling Integration

- [x] 4.1 Resolve authored feature definitions before preview requests invoke mock or OpenCascade feature execution.
- [x] 4.2 Resolve authored committed feature definitions before rebuild and history replay execution.
- [x] 4.3 Update durable feature definitions, operation history persistence, and replay so authored wrappers persist raw expression text and not resolved values.
- [x] 4.4 Update mock adapter and OpenCascade adapter tests to prove execution paths receive concrete resolved values and reject invalid authored expressions before geometry execution.
- [x] 4.5 Update existing feature persistence and replay tests for legacy literal normalization and canonical authored-wrapper writes.

## 5. Verification

- [x] 5.1 Run `bun run test`.
- [x] 5.2 Run `bun run lint`.
