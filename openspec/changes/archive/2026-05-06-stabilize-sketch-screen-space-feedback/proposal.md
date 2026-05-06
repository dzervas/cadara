## Why

During active sketch editing, sketch lines and vertices shrink and thin out too aggressively when the user zooms out. That makes basic sketch geometry hard to read and target at exactly the moment the user is trying to regain context.

Professional CAD sketch feedback should keep authoring affordances legible in screen space while the geometric positions still zoom normally. Onshape-style behavior is the intended reference: sketch strokes, points, and handles should remain visually stable enough for selection and editing instead of behaving like tiny world-space solids.

## What Changes

- Render active sketch wires with screen-space or pixel-clamped stroke sizing so line visibility does not collapse during zoom-out.
- Render active sketch vertices, endpoints, snap handles, datum handles, and similar point affordances with screen-space or pixel-clamped marker sizing.
- Keep actual sketch geometry, picking bindings, constraint state colors, hover/selection colors, construction styling, and authored SVG style semantics intact.
- Preserve normal zoom behavior for geometry positions, sketch regions, model bodies, datum planes, and non-authoring solid geometry.
- Add viewport-focused tests and browser verification that prove active sketch wires and point affordances remain legible across representative zoom levels.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `viewport-authoring-feedback`: active sketch authoring wires and point affordances must maintain screen-space legibility across zoom levels while preserving existing sketch-state styling and selection behavior.

## Impact

- Affected code is expected around the sketch viewport render path, especially `src/components/cad/three-cad-viewport-sketch-nodes.tsx`, `src/components/cad/three-cad-viewport.tsx`, and any shared viewport helper responsible for world-to-screen scale or sketch renderable material sizing.
- Test impact is in the UI lane under `docs/testing.md`, because the seam is browser-adjacent viewport rendering in `src/components` / `src/infrastructure/viewport`. A small Playwright smoke check may be needed to prove the live zoom path in the workbench.
- No persistence, file format, solver, or modeling-service contract changes are intended.
