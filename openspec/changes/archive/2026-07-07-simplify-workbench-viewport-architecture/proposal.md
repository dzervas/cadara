## Why

The workbench and viewport architecture has become difficult to reason about because bootstrap, UI composition, document/session orchestration, controller logic, debug bridges, and 3D interaction code are interleaved across misleading directories and oversized files. This change simplifies the human-facing architecture by making ownership boundaries explicit before adding more CAD behavior on top of the current shell.

Assumption: this is allowed to be a breaking internal architecture cleanup; preserving the current file layout, hook names, or controller shape is not a goal.

## What Changes

- **BREAKING**: Reorganize workbench app-layer code so `src/app` is bootstrap/composition only, while workbench feature code lives in a dedicated workbench module with clear subareas for runtime/bootstrap, controller/actions, shell/UI composition, viewport integration, documents, history, and debug.
- **BREAKING**: Replace the current "controller object soup" pattern with named workbench commands/use-cases and a thin React controller adapter that binds current state to UI events.
- **BREAKING**: Make the 3D viewport communicate through explicit typed ports: a `ViewportModel` input, `ViewportIntent` output, and `ViewportCommand` input path.
- Remove hidden editor/workbench context reads from viewport internals; the workbench controller owns editor/runtime interpretation and passes only the model required by the viewport.
- Keep the viewport module responsible for Three.js/R3F rendering, camera controls, raycasting, picking, sketch-plane projection, viewport overlays, and viewport-local transient state.
- Keep authoritative document, sketch session, selection, command, history, and modeling mutation state outside the viewport module.
- Add architectural comments only where they clarify large or convoluted files; any such file-level comment MUST start with `// SLOP:`.
- Defer channels, Jotai atoms, or other communication mechanisms until implementation; the proposal requires a typed boundary first and lets the implementation choose the smallest suitable transport.

## Capabilities

### New Capabilities

- `viewport-workbench-boundary`: Defines the explicit model/intent/command boundary between the 3D viewport module and the rest of the workbench.

### Modified Capabilities

- `workbench-application-architecture`: Clarify the workbench module layout, the role of `src/app`, the controller/action split, and the `// SLOP:` comment rule for large or convoluted files.
- `workbench-state-ownership`: Clarify that viewport communication ports or future channels/atoms must not become competing owners for document, editor, sketch, selection, or modeling state.

## Impact

- Affected code:
  - `src/app/workbench/cad-workbench.tsx`
  - `src/app/workbench/workbench-app.tsx`
  - `src/app/workbench/controllers/*`
  - `src/application/workbench/*`
  - `src/components/cad/three-cad-viewport.tsx`
  - viewport helper modules under `src/components/cad/` and `src/infrastructure/viewport/`
  - context/hook modules under `src/hooks/`
- Affected specs:
  - new `viewport-workbench-boundary`
  - deltas for `workbench-application-architecture`
  - deltas for `workbench-state-ownership`
- No runtime dependency is selected by this proposal. If channels, Jotai, `useSyncExternalStore`, or another store is used later, it must satisfy the typed port boundary rather than replace it.
- Tests should focus on architecture boundaries and behavior at the workbench/viewport seam, not source-shape assertions for private helpers unless guarding the `// SLOP:` or import-boundary rule.
