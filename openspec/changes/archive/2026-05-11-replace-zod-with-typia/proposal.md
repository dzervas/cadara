## Why

Runtime contract validation is currently implemented with Zod schemas that duplicate the TypeScript contract types they are meant to protect. That duplication is now large enough to slow contract changes and hide drift between the authored TypeScript model and the runtime checks.

## What Changes

- **BREAKING** Replace all Zod-based runtime schemas with Typia-generated validators derived from the canonical TypeScript contract types.
- **BREAKING** Remove `zod` from runtime dependencies and remove every Zod import, helper, adapter, inferred type, and schema file shape that exists only to support Zod.
- Add Typia build/test integration so Vite, Bun runtime tests, and production builds all execute transformed Typia validators instead of untransformed placeholders.
- Preserve the existing contract-boundary behavior: externally sourced and persisted payloads are still validated before typed data reaches domain/application code, and failures remain actionable.
- Convert refinements that are true domain invariants into explicit TypeScript validation helpers layered next to Typia validators, rather than reintroducing a schema DSL.
- Add repository guards proving that no Zod or deprecated compatibility validation code remains after migration.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `runtime-contract-validation`: Runtime validation must be generated from TypeScript contract types through Typia instead of maintained as duplicated Zod schemas.

## Impact

- Affects all contract/runtime-schema modules under `src/contracts/**`, especially authored documents, geometry assets, sketch payloads, durable history, workspace tabs, import/export validation, solver/render payloads, and shared references.
- Affects build and test configuration: `package.json`, Bun preload/configuration if needed, Vite plugin setup, TypeScript config, and lockfile dependencies.
- Affects validation error formatting at contract boundaries; existing user/developer-facing messages must remain explicit enough for unsupported versions, missing required fields, invalid collection sizes, invalid numeric constraints, and malformed persisted payloads.
- Adds or updates logic-lane tests at exported contract validation seams and static-lane guards for dependency/source-policy enforcement.
- Assumption: Typia is acceptable as a compile-time transformer dependency across both browser bundles and Bun-managed tests, using `@typia/unplugin` for Vite and Bun integration.
