## Why

Loft needs Onshape-like controls for path, guides, continuity, and profile alignment so users can achieve advanced loft shapes without ambiguous generic options. Path and guides are different modeling concepts and should be represented explicitly.

## What Changes

- Add an optional path participant with `sectionCount` defaulting to 5.
- Preserve optional guide curve participants separately from path.
- Allow contracts to represent path and guides together, with the kernel deciding supported combinations through validation or execution.
- Add profile start/end condition contract support for future continuity behavior.
- Add match connection contract support for twist/alignment control.
- Implement geometry for the supported path/guide/profile-condition cases in OCC.
- Ignore surface and thin loft variants.

## Capabilities

### New Capabilities

### Modified Capabilities
- `loft-feature`: Add path, guide, continuity, section count, and connection controls to loft.

## Impact

- Affects loft participants, options, authoring forms, validation, operation history, OCC loft geometry, and tests.
- Depends on `extend-feature-option-substrate`.
