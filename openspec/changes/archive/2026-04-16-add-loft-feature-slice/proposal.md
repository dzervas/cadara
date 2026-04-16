## Why

Loft is the next useful profile-family slice after sweep because it proves ordered multi-section authoring rather than profile-plus-path authoring. Implementing it separately keeps the harder section-ordering, section-compatibility, and guide-curve decisions isolated from both sweep and the much riskier wrap/enclose work.

## What Changes

- Add loft as an authored advanced solid feature available from part mode.
- Define loft participants using the advanced-solid substrate: two or more ordered profile targets, optional guide-curve targets when supported, and explicit target-body participants for boolean operation intents.
- Add loft authoring behavior, including draft defaults, ordered section selection, reordering/clearing behavior, form schema, diagnostics, preview labels, hydration, and draft-to-definition translation.
- Add modeling contract examples, operation-history validation, snapshot hydration, and adapter handling for loft payloads.
- Implement OCC-backed preview/commit for the initial supported loft path, with explicit unsupported-case diagnostics for valid but unsupported loft combinations.
- Add tests across contract, feature authoring, adapter behavior, and an extrude-like e2e user flow for loft.

## Capabilities

### New Capabilities
- `loft-feature`: Defines the user-facing and contract behavior for creating, previewing, committing, hydrating, and testing loft features through the advanced-solid feature substrate.

### Modified Capabilities

## Impact

- Affected areas include `src/contracts/modeling/**`, `src/domain/feature-authoring/**`, `src/domain/tools/**`, modeling service validation/hydration, OCC adapter feature rebuild paths, operation-history persistence, render/snapshot export, and `e2e/feature-flow.spec.ts`.
- Depends on the advanced-solid feature substrate for participant roles, operation intent, diagnostics, and milestone-level e2e expectations.
- Introduces the second profile-family proving slice; wrap should build on loft and sweep decisions instead of redefining ordered profile authoring semantics.
