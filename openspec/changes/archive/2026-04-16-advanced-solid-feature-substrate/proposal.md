## Why

The next group of missing CAD feature types spans too many shared seams to implement safely as one large feature drop or as isolated one-feature changes. Sweep, loft, thicken, enclose, face blend, chamfer, hole, external thread, mirror, split, transform, wrap, and delete-solid all need a common substrate for typed participants, operation modes, authoring diagnostics, preview behavior, and kernel-adapter obligations before individual feature proposals can stay small and coherent.

## What Changes

- Define a shared advanced-solid feature substrate for future solid and surface-adjacent operations.
- Standardize feature participant categories for profiles, paths, guide curves, faces, edges, solid bodies, tool bodies, target bodies, planes, axes, and transform references.
- Standardize operation intent for solid-producing and solid-modifying features, including `create`, `add`, `subtract`, and `intersect` where geometrically valid.
- Define how advanced features declare selection requirements, missing-input diagnostics, preview eligibility, and commit readiness through the existing feature-owned authoring model.
- Define how advanced feature contracts must preserve typed durable references and reject unsupported geometry or kernel cases explicitly instead of guessing.
- Establish a feature-family roadmap so sweep/loft/wrap, thicken/enclose/split/delete-solid, face blend/chamfer/hole/thread, and mirror/transform can be proposed and implemented as follow-up vertical slices.
- Do not implement every missing feature in this change; this change creates the shared contract and planning structure needed to implement them incrementally.

## Capabilities

### New Capabilities
- `advanced-solid-feature-substrate`: Defines the shared participant, operation, diagnostics, preview, and adapter requirements that future advanced solid feature kinds must follow.

### Modified Capabilities

## Impact

- Affected areas will include modeling contract types, feature authoring definitions, selection filters, editor draft validation, preview/commit request construction, operation-history payload expectations, snapshot hydration, OCC adapter diagnostics, and tests.
- Follow-up feature proposals should depend on this substrate rather than redefining participant, boolean, preview, or unsupported-kernel behavior per feature.
- This proposal intentionally limits immediate implementation scope so the first implementation pass can prove the substrate with a small set of representative feature slices rather than attempting the full advanced-feature list at once.
