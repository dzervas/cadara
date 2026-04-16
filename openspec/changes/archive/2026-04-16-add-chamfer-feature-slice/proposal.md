## Why

Chamfer is the next useful advanced-feature slice because it proves the local topology modifier family after sweep proves profile/path authoring. It can reuse the existing fillet-style edge selection workflow while validating that the advanced-solid substrate can represent distinct modifier parameters, preview/commit behavior, OCC diagnostics, and e2e coverage for a new edge-based feature.

## What Changes

- Add chamfer as an authored advanced solid feature available from part mode.
- Define chamfer participants using the advanced-solid substrate: one or more durable edge targets and any required owning-body context derived from those edges.
- Add chamfer authoring behavior, including draft defaults, edge selection, form schema, distance parameters, diagnostics, preview labels, hydration, and draft-to-definition translation.
- Add modeling contract examples, operation-history validation, snapshot hydration, and adapter handling for chamfer payloads.
- Implement OCC-backed preview/commit for the initial supported chamfer shape, with explicit unsupported-case diagnostics for valid but unsupported chamfer variants.
- Add tests across contract, feature authoring, adapter behavior, and an extrude-like e2e user flow for chamfer.

## Capabilities

### New Capabilities
- `chamfer-feature`: Defines the user-facing and contract behavior for creating, previewing, committing, hydrating, and testing chamfer features through the advanced-solid feature substrate.

### Modified Capabilities

## Impact

- Affected areas include `src/contracts/modeling/**`, `src/domain/feature-authoring/**`, `src/domain/tools/**`, modeling service validation/hydration, OCC adapter feature rebuild paths, operation-history persistence, render/snapshot export, and `e2e/feature-flow.spec.ts`.
- Depends on the advanced-solid feature substrate for participant roles, diagnostics, adapter unsupported-case behavior, and milestone-level e2e expectations.
- Introduces the first local topology modifier proving slice; face blend, hole, and external thread should use lessons from this change rather than redefining topology-target authoring semantics.
