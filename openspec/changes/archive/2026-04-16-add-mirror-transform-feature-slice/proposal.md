## Why

Mirror and transform belong together because they are both explicit transform-family operations over existing bodies and they force an early decision about transform scope. Pairing them in one slice lets the change define body-only transforms, reference frames, copy behavior, timeline persistence, and e2e coverage coherently instead of scattering those rules across multiple small proposals.

## What Changes

- Add mirror and transform as authored advanced solid features available from part mode.
- Define mirror participants using the advanced-solid substrate: one or more target bodies plus one explicit mirror reference such as a plane.
- Define transform participants using the advanced-solid substrate: one or more target bodies plus one explicit transform reference and typed transform options for the supported first-slice operations.
- Add authoring behavior for both features, including draft defaults, body/reference selection, transform options, diagnostics, preview labels, hydration, and draft-to-definition translation.
- Add modeling contract examples, operation-history validation, snapshot hydration, and adapter handling for mirror and transform payloads.
- Implement OCC-backed preview/commit for the initial supported mirror and transform paths, with explicit unsupported-case diagnostics for valid but unsupported combinations.
- Add tests across contract, feature authoring, adapter behavior, and e2e user flows for mirror and transform.

## Capabilities

### New Capabilities
- `mirror-transform-feature`: Defines the user-facing and contract behavior for creating, previewing, committing, hydrating, and testing mirror and transform features through the advanced-solid feature substrate.

### Modified Capabilities

## Impact

- Affected areas include `src/contracts/modeling/**`, `src/domain/feature-authoring/**`, `src/domain/tools/**`, modeling service validation/hydration, OCC adapter feature rebuild paths, operation-history persistence, render/snapshot export, and `e2e/feature-flow.spec.ts`.
- Depends on the advanced-solid feature substrate for participant roles, diagnostics, and milestone-level e2e expectations.
- Introduces the transform-family proving slice and locks in the first decision about body-only transforms versus later feature/sketch transform proposals.
