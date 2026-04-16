## Why

Thicken is the next useful body-operation slice because it bridges face/surface-driven modeling into solid creation without taking on the region-solving ambiguity of enclose. It proves that the advanced-solid substrate can express face targets, side/thickness options, snapshot/history round-tripping, kernel diagnostics, and e2e coverage for a body-generating operation that is not profile-based.

## What Changes

- Add thicken as an authored advanced solid feature available from part mode.
- Define thicken participants using the advanced-solid substrate: one or more face targets or supported sheet/body targets, plus explicit target-body participants for any boolean operation intents that the initial implementation supports.
- Add thicken authoring behavior, including draft defaults, target selection, thickness and direction parameters, diagnostics, preview labels, hydration, and draft-to-definition translation.
- Add modeling contract examples, operation-history validation, snapshot hydration, and adapter handling for thicken payloads.
- Implement OCC-backed preview/commit for the initial supported thicken shape, with explicit unsupported-case diagnostics for valid but unsupported thicken combinations.
- Add tests across contract, feature authoring, adapter behavior, and an extrude-like e2e user flow for thicken.

## Capabilities

### New Capabilities
- `thicken-feature`: Defines the user-facing and contract behavior for creating, previewing, committing, hydrating, and testing thicken features through the advanced-solid feature substrate.

### Modified Capabilities

## Impact

- Affected areas include `src/contracts/modeling/**`, `src/domain/feature-authoring/**`, `src/domain/tools/**`, modeling service validation/hydration, OCC adapter feature rebuild paths, operation-history persistence, render/snapshot export, and `e2e/feature-flow.spec.ts`.
- Depends on the advanced-solid feature substrate for participant roles, operation intent, diagnostics, and milestone-level e2e expectations.
- Introduces the first surface/body-operation proving slice; enclose should build on lessons from this change instead of redefining thicken-style target authoring semantics.
