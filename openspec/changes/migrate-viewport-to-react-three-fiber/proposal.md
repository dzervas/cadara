## Why

The viewport currently relies on a large imperative Three.js integration that manually manages renderer lifecycle, controls, resize behavior, picking, sketch-plane projection, and the view cube. That code is expensive to maintain, hard to evolve safely, and duplicates responsibilities that React Three Fiber and drei already solve well.

## What Changes

- Replace the current imperative viewport renderer setup with a React Three Fiber scene runtime.
- Adopt drei primitives for orbit controls, grid, and orientation-gizmo behavior instead of maintaining those behaviors with custom renderer glue.
- Preserve existing workbench viewport behavior for hover, selection, sketch-plane projection, and sketch camera framing while moving those behaviors onto the new runtime.
- Keep CAD/domain logic, renderable contracts, and editor event dispatch outside presentational viewport components.
- Add the new viewport dependencies and remove custom code paths that only exist to manage Three.js lifecycle concerns.

## Capabilities

### New Capabilities
- `viewport-runtime-parity`: The workbench viewport preserves current interaction and navigation behavior while using a declarative React Three Fiber and drei runtime.

### Modified Capabilities

## Impact

- Affected code includes `src/components/cad/three-cad-viewport.tsx`, `src/domain/workspace/render-picking.ts`, `src/domain/workspace/scene-factory.ts`, `src/domain/workspace/view-navigation.ts`, and related viewport tests.
- Adds external dependencies for `@react-three/fiber` and `@react-three/drei`.
- Likely requires integration and e2e coverage for picking, sketch drawing projection, hover and selection, and view-cube camera navigation.
- Does not change modeling contracts, sketch persistence schema, or kernel semantics.
