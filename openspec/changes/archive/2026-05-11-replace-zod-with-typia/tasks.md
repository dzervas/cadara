## 1. Inventory and Transformer Setup

- [x] 1.1 Inventory every Zod dependency, import, `z.infer`, `.parse`, `.safeParse`, `ZodError`, `ZodIssue`, and Zod-shaped validation API in source, tests, package metadata, and lockfiles.
- [x] 1.2 Add `typia` and `@typia/unplugin`, remove `zod`, and update the lockfile through Bun.
- [x] 1.3 Configure Typia transformation in `vite.config.ts` and `vite.single.config.ts` without disrupting the existing React, Tailwind, Sentry, OCC asset, and single-file build plugins.
- [x] 1.4 Configure Typia transformation for Bun runtime and Bun test execution, including any required preload or Bun config changes.
- [x] 1.5 Add a minimal generated-validator sentinel that fails clearly if Typia transformation is not active in build or test execution.

## 2. Validation Foundation

- [x] 2.1 Replace Zod-specific application error adaptation with a validation-neutral adapter for Typia `IValidation` failures and explicit post-validation invariant failures.
- [x] 2.2 Define shared validation result/parser helpers that expose repository-owned APIs instead of `.parse`, `.safeParse`, or any Zod-compatible facade.
- [x] 2.3 Migrate shared primitive, version, ID, reference, and sketch-plane contract validation to TypeScript contract types plus Typia-generated validators.
- [x] 2.4 Move primitive constraints that are part of serialized contract shape into Typia-supported TypeScript type tags or named contract helper types.
- [x] 2.5 Extract cross-field, collection, graph, and predicate invariants into named post-validation helpers that compose with generated validators.

## 3. Contract Family Migration

- [x] 3.1 Migrate authored model document, feature definition, authored-value, operation-history, durable-history, and document-repository validation off Zod.
- [x] 3.2 Migrate geometry asset, exact B-rep, baked mesh, native topology payload, and OCC worker protocol validation off Zod.
- [x] 3.3 Migrate sketch definition, sketch authoring operations, reference-image operation state, solver, render, and workspace tab validation off Zod.
- [x] 3.4 Migrate import/export provider validation, prepared actions, import bindings, resolved sources, diagnostics, and export result/request validation off Zod.
- [x] 3.5 Update all consumers to use the new exported validation APIs directly, with no compatibility aliases for old schema exports.
- [x] 3.6 Remove legacy literal migration and deprecated validation normalization branches; canonicalize repo-owned fixtures and sample documents that depended on them.

## 4. Tests and Static Enforcement

- [x] 4.1 Read `docs/testing.md` before editing tests, then state the chosen lanes and seams in the implementation commentary.
- [x] 4.2 Update logic-lane contract tests to prove successful parsing, strict extra-field rejection, unsupported versions, malformed persisted payloads, invalid numeric/list constraints, authored-value failures, and post-validation invariant failures at exported validation seams.
- [x] 4.3 Update OCC/native-topology and worker protocol tests that previously asserted Zod `.parse` or `.safeParse` behavior to assert the repository-owned validation API.
- [x] 4.4 Update application error tests to use Typia/validation-neutral failures rather than `ZodError` fixtures.
- [x] 4.5 Add or update static-lane guards that fail on Zod dependencies/imports/types, Zod-shaped validation APIs, deprecated validation compatibility facades, and untransformed Typia setup gaps.

## 5. Cleanup and Verification

- [x] 5.1 Run targeted `rg` scans proving no Zod references, deprecated validation shims, `.safeParse`, `.parse` schema facades, or old runtime schema DSL leftovers remain.
- [x] 5.2 Run `bun run lint` and fix type/lint fallout from removed schema exports and renamed validation APIs.
- [x] 5.3 Run `bun run build` and `bun run build:single` to verify Typia transformation across both browser bundle paths.
- [x] 5.4 Run `bun run test` and fix logic, UI, and static lane regressions.
- [x] 5.5 Run `bun run test:e2e` and fix browser flow regressions caused by validation or fixture canonicalization.
- [x] 5.6 Run `bun run test:all` as the final verification gate.
