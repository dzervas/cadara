## Why

The `improve-feature-form-selection` work can collect and display multiple profile-like selections in the form layer, but the durable feature contract still forces extrude and revolve into a single `profile` seed. The modeling contract needs to represent the actual CAD operation shape directly now that feature authoring can provide multiple selected profiles.

## What Changes

- **BREAKING** Replace singular profile parameters for profile-based features with ordered profile collections, starting with `ExtrudeFeatureParameters.profiles` and `RevolveFeatureParameters.profiles`.
- Require extrude and revolve create/update/preview definitions to carry at least one explicit profile reference and reject empty profile arrays at the contract boundary.
- Preserve durable explicitness: every profile entry remains a typed region or planar-face reference, with no whole-sketch inference or side-band generic reference arrays.
- Define validation expectations for duplicate profile references, unsupported profile mixtures, and profile groups that are individually valid but invalid together.
- Update feature authoring drafts, form schema bindings, adapter handling, operation-history examples, and tests so multi-profile selection can flow from the inspector into preview, commit, rebuild, and snapshot hydration.
- Confirm other multi-target features such as fillet edge lists and shell removable-face lists already use collection-shaped contract fields and remain consistent with the same validation rules.

## Capabilities

### New Capabilities
- `profile-based-feature-contract`: Defines the durable modeling contract behavior for profile-based features that accept one or more explicit profile references.

### Modified Capabilities

## Impact

- Affected code includes `src/contracts/modeling/**`, `src/contracts/shared/versioning.ts`, modeling operation-history fixtures/tests, feature authoring definitions for extrude and revolve, editor draft/schema typing, OCC adapter preview/commit/rebuild handling for profile-based operations, and contract-facing tests.
- This intentionally breaks the previous singular `profile` field shape for extrude and revolve; no compatibility shim or legacy alias is required.
