## Why

Sweep needs advanced Onshape-like controls for profile orientation, twist, and scale so users can model controlled swept geometry without hand-building separate profiles or workarounds.

## What Changes

- Add sweep profile control options: none, keep profile orientation, lock profile faces, and lock profile direction.
- Add a discriminated sweep twist option with turns, angle, and pitch variants.
- Add end scale support that proportionally changes the profile size at the end of the sweep path.
- Keep inactive twist values out of the durable modeling contract.
- Implement the geometry now in the OCC adapter and preserve all options through preview, commit, history, snapshots, and edit hydration.
- Ignore surface and thin sweep variants.

## Capabilities

### New Capabilities

### Modified Capabilities
- `sweep-feature`: Add advanced sweep profile control, twist, and scale behavior.

## Impact

- Affects sweep authoring drafts/forms, advanced-solid option descriptors, runtime validation, modeling adapter sweep execution, operation history, and tests.
- Depends on `extend-feature-option-substrate`.
