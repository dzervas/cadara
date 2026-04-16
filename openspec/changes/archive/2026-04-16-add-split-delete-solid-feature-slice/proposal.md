## Why

Split and delete-solid belong together because they both operate directly on existing solid bodies and together prove the body-management path in the advanced-solid family. Pairing them in one slice lets the change cover body targeting, body lifecycle in snapshots/history, kernel diagnostics, and e2e flows without scattering tightly related body-operation semantics across multiple small proposals.

## What Changes

- Add split and delete-solid as authored advanced solid features available from part mode.
- Define split participants using the advanced-solid substrate: one or more target bodies plus one explicit split tool such as a tool body or plane, with explicit diagnostics for unsupported tool combinations.
- Define delete-solid participants using the advanced-solid substrate: one or more body targets to remove from the document.
- Add authoring behavior for both features, including draft defaults, body/tool selection, diagnostics, preview labels, hydration, and draft-to-definition translation.
- Add modeling contract examples, operation-history validation, snapshot hydration, and adapter handling for split and delete-solid payloads.
- Implement OCC-backed preview/commit for the initial supported split and delete-solid paths, with explicit unsupported-case diagnostics for valid but unsupported combinations.
- Add tests across contract, feature authoring, adapter behavior, and e2e user flows for split and delete-solid.

## Capabilities

### New Capabilities
- `split-delete-solid-feature`: Defines the user-facing and contract behavior for creating, previewing, committing, hydrating, and testing split and delete-solid features through the advanced-solid feature substrate.

### Modified Capabilities

## Impact

- Affected areas include `src/contracts/modeling/**`, `src/domain/feature-authoring/**`, `src/domain/tools/**`, modeling service validation/hydration, OCC adapter feature rebuild paths, operation-history persistence, render/snapshot export, and `e2e/feature-flow.spec.ts`.
- Depends on the advanced-solid feature substrate for participant roles, diagnostics, and milestone-level e2e expectations.
- Introduces the main body-operation proving slice; enclose should build on these body-targeting and body-lifecycle decisions rather than redefining them.
