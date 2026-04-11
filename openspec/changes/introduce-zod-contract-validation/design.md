## Context

The deepest validation code concentration is in `src/domain/modeling/modeling-service.ts`, which manually reconstructs snapshots, render exports, sketch payloads, features, diagnostics, and references from `unknown` input through a long chain of `assert*` and `normalize*` helpers. The same repo also contains a second manual validation surface in `src/contracts/modeling/operation-history.ts` for persisted history, plus additional top-level request-envelope guards in the modeling and solver adapters.

These boundary validators are solving the right problem, but the implementation is fragmented:
- runtime payload structure lives in `src/contracts/**`
- runtime validation logic is duplicated separately in `src/domain/**`
- error messages vary in specificity and consistency across boundaries

The code-reduction opportunity is real, but it is not uniform. Some checks are transport or persistence schema validation and are strong Zod candidates. Others are domain invariants over geometry, topology, or workflow state and should remain plain code because a schema library would not make them smaller or clearer.

## Goals / Non-Goals

**Goals:**
- Consolidate runtime validation for externally sourced and persisted payloads into shared Zod schemas.
- Reduce code size by replacing large hand-written normalization and validation chains at contract boundaries.
- Standardize validation failures so boundary errors expose explicit, actionable messages.
- Scope custom error messages to the places where users or developers need them most: persisted history loading, version mismatches, malformed request/response envelopes, non-empty contract collections, and numeric constraints.
- Preserve existing domain and kernel semantics while changing only validation ownership.

**Non-Goals:**
- Replacing every `throw new Error` in the repo with Zod.
- Reworking internal OCC math, topology, rendering, or state-machine invariants into schemas.
- Replacing feature draft patch guards or UI-local form patch logic unless that clearly removes code later.
- Forcing a full schema-first rewrite of every TypeScript contract in one pass if incremental adoption is smaller and safer.

## Decisions

### Use Zod only at transport and persistence boundaries

The migration should target payloads that enter the system from adapters, persistence, or serialized contract boundaries. That includes modeling snapshots, render exports, sketch/solver payloads, and persisted operation-history data.

This is preferable to a repo-wide conversion because the biggest code reduction lives at those boundaries, while internal invariant checks are usually clearer as direct code.

Alternative considered:
- Converting all domain guards and invariants to Zod. This would expand scope and often produce more code, not less.

### Prioritize the highest-volume validator first: modeling-service normalization

`modeling-service.ts` should be the first migration target because it contains the largest manual validation surface and the clearest duplication of contract structure.

This is preferable to starting with smaller modules because it delivers most of the code-size reduction and proves the schema organization against the most complex payload family.

Alternative considered:
- Starting with operation history or one adapter first. Lower risk, but smaller payoff and weaker guidance for the larger schema layout.

### Migrate operation-history validation fully, including persistence-facing messages

`validateOperationHistoryPayload` and the storage load path are strong Zod candidates because they already act as a strict public-ish persistence contract with explicit failure cases.

This is preferable to leaving operation history on bespoke validation because it duplicates the same contract-validation problem in a second place and is one of the few places where end-user-facing recovery depends on error quality.

Alternative considered:
- Keep custom validation for history because it already has good messages. That preserves duplication and leaves the boundary inconsistent with the rest of the migration.

### Keep adapter request-envelope validation small and schema-owned

Top-level request-envelope checks in the modeling and solver adapters should move to shared Zod schemas for version fields, required IDs, and envelope structure. Adapter-specific semantic checks, such as document identity expectations or revision mismatch behavior, may remain code after schema parsing.

This is preferable to pushing all adapter logic into schemas because semantic environment checks are not pure shape validation.

Alternative considered:
- Keep adapter envelope validation handwritten. That would miss one of the easiest opportunities to remove repeated `contractVersion` and `schemaVersion` guards.

### Add custom Zod error messages selectively, not exhaustively

Custom messages should be added where they materially improve diagnostics:
- unsupported `contractVersion`, `schemaVersion`, and solver schema version
- invalid persisted history JSON
- missing required top-level payload sections
- empty collections that are contract-invalid, such as required profile arrays
- positive numeric constraints where the domain contract already requires positivity

Nested leaf fields that are only type mismatches do not need hand-authored messages unless they are surfaced directly to users or storage recovery flows. Default Zod issue formatting is sufficient there.

This is preferable to attaching custom messages to every field because exhaustive message customization would add noise and reduce the code-size benefit.

Alternative considered:
- Use only default Zod errors everywhere. Simpler, but too weak for persisted-history recovery and contract version mismatch diagnostics.

### Adopt an incremental schema ownership model

The implementation may keep some existing exported TypeScript types during the migration, but the target direction is that boundary schemas become the source of truth where doing so reduces duplication. Types should be inferred from Zod where practical, especially for persistence and transport modules introduced or fully rewritten during this change.

This is preferable to an all-at-once rewrite because it allows the highest-value files to migrate first without destabilizing unrelated modules.

Alternative considered:
- Immediately rewrite every contract type to be Zod-inferred. Cleaner in theory, but too broad for one change and likely to create churn beyond the code-reduction target.

## Risks / Trade-offs

- [Schema migration could create temporary duplication between interfaces and Zod schemas] → Mitigate by targeting the largest duplicated validators first and converging fully on schema ownership in those modules.
- [Over-customizing error messages could offset the code-size reduction] → Mitigate by limiting custom messages to high-signal contract failures and using default Zod issues for low-level nested mismatches.
- [Large discriminated unions may become harder to scan if schema organization is poor] → Mitigate by grouping schemas by boundary and payload family rather than keeping one monolithic schema file.
- [Some branded ID semantics may not map cleanly to runtime schemas] → Mitigate by validating runtime shape as strings/enums at the boundary and preserving stronger compile-time aliases where needed.
- [Refactors in validation code can mask behavior regressions] → Mitigate by preserving current rejection semantics in tests before deleting old validators.

## Migration Plan

1. Add `zod` and introduce shared schema modules for transport and persistence boundaries.
2. Migrate operation-history validation and storage loading to Zod-backed schemas with explicit persistence-facing messages.
3. Migrate modeling-service response normalization to Zod-backed parsing for snapshots, render exports, sketch payloads, diagnostics, and feature payloads.
4. Migrate modeling and solver request-envelope validation to shared Zod schemas while keeping semantic environment checks in adapter code.
5. Delete obsolete handwritten validators once contract and persistence tests demonstrate parity.

Rollback:
- Revert the Zod-backed parser modules and restore the existing handwritten validators.
- Because the contract payload shapes remain the same, rollback is implementation-local rather than a data migration.

## Open Questions

- Whether render/export and snapshot schemas should fully replace their existing TypeScript contract declarations in this change or only back them incrementally.
- Whether the repo wants one central contract-schema package under `src/contracts/**` or separate schema modules adjacent to each contract family.
- Whether boundary validation failures should be wrapped into one project-specific error shape or surfaced as normalized Zod issues plus current reason-code wrappers.
