## 1. Contract Model

- [x] 1.1 Add typed advanced option descriptor variants for boolean, enum, angle, positive number, positive integer, group, and discriminated group options.
- [x] 1.2 Add shared validation helpers for required options, value-kind validation, and durable rejection of inactive discriminated variant values.
- [x] 1.3 Add tests covering option descriptor validation and inactive discriminated values.

## 2. Form Schema

- [x] 2.1 Extend the feature editor form schema with grouped/discriminated option presentation support.
- [x] 2.2 Extend the form adapter to emit patches for nested option fields without feature-specific branching.
- [x] 2.3 Add focused form schema and adapter tests for conditional advanced option fields.

## 3. Authored Values

- [x] 3.1 Add positive integer authored value metadata and resolver validation.
- [x] 3.2 Ensure angle, numeric, boolean, enum, and integer option values preserve literal/expression sources.
- [x] 3.3 Add tests for expression-authored advanced option values and invalid reference-expression attempts.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
