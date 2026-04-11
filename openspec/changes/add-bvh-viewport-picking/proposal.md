## Why

Viewport picking currently raycasts against the full scene object set without an acceleration structure. As renderable counts grow, hover and selection cost will scale poorly, which risks making normal CAD authoring interactions feel sluggish even when the actual target-resolution logic is correct.

## What Changes

- Add BVH-backed raycast acceleration for viewport picking so hover and selection scale better with larger scene complexity.
- Keep durable target binding, selection filtering, and hover-resolution behavior unchanged while accelerating the geometric intersection phase.
- Introduce a viewport-owned BVH integration that works with the current renderable contract and does not require a full rendering-runtime migration.
- Define rebuild and invalidation behavior so BVH data stays in sync when viewport geometry changes.
- Add focused verification for hover and selection parity plus performance-oriented picking stability on denser scenes.

## Capabilities

### New Capabilities
- `viewport-picking-acceleration`: The workbench viewport uses BVH-backed raycast acceleration for document geometry while preserving existing hover and selection semantics.

### Modified Capabilities

## Impact

- Affected code includes `src/components/cad/three-cad-viewport.tsx`, `src/domain/workspace/render-picking.ts`, and related viewport tests.
- Adds a new dependency on a BVH acceleration library for Three.js raycasting.
- Improves the picking path without changing modeling contracts, editor command semantics, or renderable target bindings.
