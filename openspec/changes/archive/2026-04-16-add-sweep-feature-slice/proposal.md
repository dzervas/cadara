## Why

Sweep is a good first advanced-feature vertical slice because it exercises the new profile/path participant substrate without taking on the broader region-solving semantics of enclose or the specialized manufacturing semantics of threads. Implementing it next proves that an advanced feature can move through toolbar activation, typed authoring, preview/commit, snapshot/history, OCC diagnostics, and e2e coverage as one coherent slice.

## What Changes

- Add sweep as an authored advanced solid feature available from part mode.
- Define sweep participants using the advanced-solid substrate: one or more profile targets, one required path target, optional guide-curve targets when supported, and explicit target-body participants for boolean operation intents.
- Add sweep authoring behavior, including draft defaults, selection filters, form schema, diagnostics, preview labels, hydration, and draft-to-definition translation.
- Add modeling contract examples, operation-history validation, snapshot hydration, and adapter handling for sweep payloads.
- Implement OCC-backed preview/commit for the initial supported sweep path, with explicit unsupported-case diagnostics for valid but unsupported sweep combinations.
- Add tests across contract, feature authoring, adapter behavior, and an extrude-like e2e user flow for sweep.

## Capabilities

### New Capabilities
- `sweep-feature`: Defines the user-facing and contract behavior for creating, previewing, committing, hydrating, and testing sweep features through the advanced-solid feature substrate.

### Modified Capabilities

## Impact

- Affected areas include `src/contracts/modeling/**`, `src/domain/feature-authoring/**`, `src/domain/tools/**`, modeling service validation/hydration, OCC adapter feature rebuild paths, operation-history persistence, render/snapshot export, and `e2e/feature-flow.spec.ts`.
- Depends on the advanced-solid feature substrate for participant roles, operation intent, diagnostics, and milestone-level e2e expectations.
- Introduces the first feature-family proving slice for profile/path advanced features; loft and wrap should use lessons from this change rather than redefining profile/path semantics.
