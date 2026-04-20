## Why

Extrude and revolve currently support only simple blind distance/angle extents. Advanced CAD workflows need Onshape-like end controls including up-to targets, through-all behavior, draft angle, symmetric extents, and independent second-end extents without duplicating the same behavior in each feature.

## What Changes

- Add shared typed extent primitives for one-side, symmetric, and two-side profile-based features.
- Extend extrude with blind, up to next, up to face, up to part, up to vertex, and through all end conditions.
- Extend revolve with full revolve, blind, up to next, up to face, up to part, and up to vertex end conditions.
- Add offset support for up-to end conditions where Onshape exposes fall-short/overrun behavior.
- Add draft angle support for extrude ends; symmetric extents mirror the draft automatically and cannot also define a second end.
- Implement geometry for the new end controls in the OpenCascade pipeline rather than accepting unsupported placeholders.
- Ignore surface and thin variants for this change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `profile-based-feature-contract`: Add advanced extent and draft contract behavior for extrude and revolve.
- `occ-basic-feature-operations`: Implement OCC-backed geometry for advanced extrude and revolve end controls.

## Impact

- Affects modeling contracts, runtime schemas, authored value metadata, feature authoring drafts/forms, operation-history persistence, snapshot hydration, OCC adapter geometry, and tests.
- Depends on the shared option/extent primitives from `extend-feature-option-substrate`.
- Starting offset remains out of scope; this change targets the requested end-position, draft, symmetry, and up-to controls rather than full extrude dialog parity.
