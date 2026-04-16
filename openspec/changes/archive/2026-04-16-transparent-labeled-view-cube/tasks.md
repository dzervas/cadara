## 1. Shared Navigation Presets

- [x] 1.1 Extend `src/domain/workspace/view-navigation.ts` to expose shared snap presets or vectors for the six labeled face views and eight cube-corner isometric views.
- [x] 1.2 Update `src/domain/workspace/view-navigation.spec.ts` to cover both principal face snaps and representative corner snap behavior.

## 2. Transparent View Cube Renderer

- [x] 2.1 Refactor the view-cube scene setup in `src/components/cad/three-cad-viewport.tsx` so visible edge geometry, centered face labels, and hit targets are modeled separately.
- [x] 2.2 Remove the current panel-style view-cube wrapper styling and render the overlay as a background-free transparent navigation cube.
- [x] 2.3 Add clickable face and corner targets that route to the shared navigation presets while preserving existing viewport pointer-isolation behavior.

## 3. Verification

- [x] 3.1 Add or update viewport-facing tests for the transparent labeled cube behavior where practical, and verify the existing navigation tests still cover the shared camera snap path.
- [x] 3.2 Run `bun run test` and `bun run lint`.
