## 1. Contract Model

- [ ] 1.1 Add typed advanced option descriptor variants for boolean, enum, angle, positive number, positive integer, group, and discriminated group options.
- [ ] 1.2 Add shared validation helpers for required options, value-kind validation, and durable rejection of inactive discriminated variant values.
- [ ] 1.3 Add tests covering option descriptor validation and inactive discriminated values.

## 2. Form Schema

- [ ] 2.1 Extend the feature editor form schema with grouped/discriminated option presentation support.
- [ ] 2.2 Extend the form adapter to emit patches for nested option fields without feature-specific branching.
- [ ] 2.3 Add focused form schema and adapter tests for conditional advanced option fields.

## 3. Authored Values

- [ ] 3.1 Add positive integer authored value metadata and resolver validation.
- [ ] 3.2 Ensure angle, numeric, boolean, enum, and integer option values preserve literal/expression sources.
- [ ] 3.3 Add tests for expression-authored advanced option values and invalid reference-expression attempts.

## 4. Verification

- [ ] 4.1 Run `bun run test`.
- [ ] 4.2 Run `bun run lint`.
- [ ] 4.3 Run `bun run build`.
