## Context

The current runtime contract layer protects external and persisted payloads with Zod schemas in `src/contracts/**`, plus a few adjacent worker/import/OCC seams. Those schemas mostly restate TypeScript contracts, then export parsed values through `z.infer`, `.transform(...)`, `.safeParse(...)`, and `.parse(...)` entrypoints. The result is a second data model that must be edited alongside the real TypeScript model.

Typia changes the ownership model: TypeScript contract types become the source of truth, and runtime validators are generated ahead of time by the build/test pipeline. Current Typia setup guidance supports Bun installation, `@typia/unplugin` for Vite, and Bun runtime/test preloads; Typia also distinguishes permissive `is`/`validate` checks from strict `equals`/`validateEquals` checks that reject superfluous properties.

The repo is pre-alpha and the requested change explicitly allows breaking removal. This migration should therefore update callers and fixtures to the new validation API directly instead of preserving Zod-shaped compatibility aliases.

## Goals / Non-Goals

**Goals:**

- Remove Zod completely from dependencies, imports, type references, tests, and validation helpers.
- Make TypeScript contract types the canonical validation source for external and persisted payloads.
- Wire Typia transforms into every path that executes validators: Vite dev/build, single-file Vite build, Bun tests, and any worker/runtime entrypoints exercised by those builds.
- Keep contract-boundary failures actionable enough to debug malformed persisted files, unsupported versions, invalid numeric/list constraints, and malformed worker/import/export payloads.
- Keep internal invariants in explicit TypeScript helpers where they are not pure structural type checks.
- Add behavior coverage at exported validation seams and static guards that fail if Zod or deprecated validation compatibility surfaces return.

**Non-Goals:**

- Do not introduce another runtime schema DSL to replace Zod.
- Do not preserve `.safeParse`, `.parse`, `ZodError`, `ZodIssue`, `z.infer`, or other Zod-shaped APIs as compatibility shims.
- Do not keep legacy migration/normalization branches solely to support old pre-alpha payload shapes.
- Do not redesign the persisted document model beyond changes required to express current contracts as Typia-valid TypeScript types.

## Decisions

1. TypeScript contract types become the validation source of truth.

   Zod files currently encode both runtime checks and derived output types. The migration should invert that: canonical interfaces/type aliases in the contract modules own the shape, and validation modules export generated validators/parsers for those types. This removes duplicate schema definitions and makes compile errors the inventory for call sites that still depend on Zod-specific exports.

   Alternative considered: keep Zod schemas and infer TypeScript from them. That would reduce some duplication but keeps the runtime DSL as the canonical model, which is opposite the requested direction.

2. Use strict Typia validators for boundary payloads.

   External/persisted payload entrypoints should default to `typia.createValidateEquals<T>()`, `typia.createAssertEquals<T>()`, or local wrappers around those generated functions so unknown properties are rejected like the existing `.strict()` object schemas. Permissive `validate`/`is` should be reserved for intentionally loose internal inputs and must be justified at the call site.

   Alternative considered: use `typia.validate<T>()` everywhere. That allows superfluous object properties and would weaken current strict Zod object behavior.

3. Express primitive constraints as type-level tags when they are contract shape.

   Required constraints such as positive numbers, non-negative integers, finite collection lengths, URL strings, UUID-like identifiers, and content-hash strings should move to named contract types using Typia tags where Typia can generate the check directly. The named types should live with the owning contract family, not in a generic bag of unowned aliases.

   Alternative considered: leave all refinements as post-validation code. That would remove Zod but still duplicate basic field constraints beside the TypeScript model.

4. Keep cross-field and graph invariants as explicit post-validation helpers.

   Some current `superRefine` checks validate relationships that are not expressible as plain structural TypeScript types: unique IDs, matching array lengths across knot/multiplicity/weight data, valid topology references, active-tab membership, or repository URL predicates. These should become named TypeScript functions called after Typia structural validation, returning the same repository validation result shape used by the boundary parser.

   Alternative considered: force every invariant into Typia custom tags. That would obscure domain rules inside string-based tag expressions and make complex CAD/topology checks harder to review.

5. Replace Zod error adaptation with a validation-neutral error adapter.

   `appErrorFromZodError` and tests built around `ZodError` should be replaced with an adapter that accepts Typia `IValidation` failures plus post-validation invariant failures. It should normalize paths, expected values, and messages into existing application error codes without exposing Typia internals across the application.

   Alternative considered: wrap Typia failures in a fake Zod-like error object. That would leave deprecated API shape in place and make future callers unclear about the real validation backend.

6. Install Typia as a build-time contract, not an optional runtime detail.

   The migration is incomplete unless untransformed Typia calls fail during ordinary development. Configure `@typia/unplugin` in both Vite configs, configure Bun runtime/test preload or an equivalent supported path, and add a small build/test sentinel proving a generated Typia validator executes without the "no transform has been configured" failure.

   Alternative considered: use Typia generation mode into checked-in generated files. That is a viable fallback only if Bun/Vite transformer integration proves incompatible with the repo's TypeScript/Vite versions; it adds generated source churn and should not be the first choice.

7. Keep static validation policy focused on repo-owned validation surfaces.

   The static policy blocks direct Zod dependencies in package metadata and Zod-shaped validation APIs in source, tests, and e2e code. Transitive lockfile entries from development tools are allowed because they are not repo-owned runtime validation surfaces.

## Risks / Trade-offs

- Typia transformer integration can fail silently or only at runtime in some toolchains. -> Add a dedicated sentinel test and ensure `bun run build`, `bun run test`, and `bun run test:all` execute at least one generated validator.
- Typia may reject or poorly express some existing branded/intersection types. -> Convert those brands into Typia-supported tags or validate the primitive structurally, then apply a named post-validation invariant.
- Error messages will not be byte-for-byte identical to Zod issues. -> Preserve actionable content and test the high-signal message categories rather than exact Zod wording.
- Removing legacy migration paths can break old local `.cadara` files and fixtures. -> Canonicalize fixtures and public sample documents during the migration; unsupported old payloads should fail with explicit validation errors.
- The migration touches many contract seams at once. -> Work by exported contract family, run the build early to inventory stale Zod exports, and keep static guards separate from behavior tests.

## Migration Plan

1. Add Typia dependencies and transformer wiring for Vite, single-file Vite, and Bun test/runtime execution.
2. Introduce a small validation helper layer that wraps Typia validation results and post-validation invariant failures into the repository's existing application error shape.
3. Migrate shared primitive/version/reference contracts first, because most other contract validators depend on them.
4. Migrate authored documents, modeling mutation/runtime payloads, durable history, geometry assets, sketch payloads, solver/render payloads, import/export payloads, workspace tabs, OCC worker protocol, and native topology payload parsing.
5. Replace call sites and tests that use `.parse`, `.safeParse`, `z.infer`, `ZodError`, or Zod-specific issue shapes with exported Typia validation functions and validation-neutral result assertions.
6. Remove direct `zod` package metadata dependencies, then add static guards that fail on Zod imports, Zod terminology in validation APIs, deprecated validation facades, and direct dependency reintroduction.
7. Canonicalize any repo-owned fixtures or public sample payloads that depended on legacy Zod normalization.
8. Run `bun run test:all` as the final gate.

Rollback is not a compatibility strategy for this pre-alpha cleanup. If a partial migration proves too risky, revert the entire change before merging rather than leaving mixed Zod and Typia validation paths.

## Open Questions

- None for proposal scope. During implementation, if Typia's transformer path is incompatible with the current TypeScript/Vite/Bun versions, the implementer should pause and choose between generation mode and a toolchain adjustment rather than silently keeping Zod.
