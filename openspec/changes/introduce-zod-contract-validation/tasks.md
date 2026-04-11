## 1. Zod Contract Foundation

- [ ] 1.1 Add `zod` to the project and introduce shared schema modules for modeling, sketch, solver, render-export, and operation-history boundary payloads.
- [ ] 1.2 Define the initial Zod schemas for versioned request/response envelopes, persisted operation-history payloads, and the highest-volume snapshot/render payloads.
- [ ] 1.3 Add targeted custom schema messages for contract version mismatches, schema version mismatches, invalid persisted history JSON, required top-level sections, non-empty collections, and positive numeric constraints.

## 2. Boundary Migration

- [ ] 2.1 Replace the handwritten operation-history validators in `src/contracts/modeling/operation-history.ts` with Zod-backed parsing while preserving explicit failure reason codes.
- [ ] 2.2 Replace the persistence load-path validation in `src/domain/modeling/modeling-history-persistence.ts` with the new Zod-backed operation-history schemas.
- [ ] 2.3 Replace the manual snapshot, render-export, sketch, feature, and diagnostic normalization chain in `src/domain/modeling/modeling-service.ts` with shared Zod-backed parsing helpers.
- [ ] 2.4 Replace handwritten top-level request-envelope validation in the modeling and solver adapters with shared Zod-backed parsing, while preserving adapter-specific semantic checks in code.

## 3. Cleanup And Verification

- [ ] 3.1 Remove obsolete `assert*`, `normalize*`, and ad hoc record/string guards that become redundant after schema migration.
- [ ] 3.2 Add or update tests covering malformed payload rejection, version mismatch rejection, persisted-history validation failures, and representative success cases for snapshots and operation histories.
- [ ] 3.3 Verify that internal geometry and workflow invariant checks that are intentionally out of scope remain code-level assertions and are not replaced with schema boilerplate.
