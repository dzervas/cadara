## 1. Contract And Domain Foundations

- [x] 1.1 Extend the typed modeling contract with a first-class `shell` feature definition, schema/version exports, normalization, and contract examples/tests.
- [x] 1.2 Add or update domain feature-draft helpers for `revolve`, `fillet`, `shell`, and `plane`, including defaults, hydration from committed snapshots, draft patching, and feature-definition builders.
- [x] 1.3 Generalize feature edit-session state and editor runtime wiring so preview/create/update flows can operate on supported feature kinds instead of extrude only.

## 2. OCC Feature Operation Coverage

- [x] 2.1 Finish OCC adapter preview/create/update handling for `revolve`, `fillet`, and `plane` so committed rebuilds and diagnostics follow the typed contract.
- [x] 2.2 Implement `shell` through the OCC adapter, supporting preview, create, update, snapshot serialization, and durable target reporting.
- [x] 2.3 Align boolean-capable solid features with explicit boolean scope behavior, including standalone, single-target, and multi-target join/cut/intersect policies.

## 3. Feature Session UI

- [x] 3.1 Replace the extrude-only feature inspector with a feature-kind-aware session form that renders the correct controls for extrude, revolve, fillet, shell, and plane sessions.
- [x] 3.2 Replace slider-based dimensional controls with numeric inputs for depth, radius, thickness, angles, offsets, and other length-like feature parameters.
- [x] 3.3 Surface typed reference state and diagnostics in the session UI so profile, axis, edge, face, construction, and boolean-target selections remain explicit during preview and commit.

## 4. Verification

- [x] 4.1 Add or expand unit tests for contract normalization, feature-session hydration/builders, and state-machine preview/update flows across the supported feature kinds.
- [x] 4.2 Add or expand OCC-focused tests covering revolve, fillet, plane, shell, and boolean policy behavior for preview, create, update, rebuild, and rejection diagnostics.
- [x] 4.3 Verify the workbench flow end to end so supported feature sessions open correctly, numeric parameter entry updates previews, and commit/cancel behavior remains stable.
