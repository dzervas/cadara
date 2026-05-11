## Why

Sketch editing can freeze the browser after minimal use because active sketch pointer movement currently drives expensive display derivation on every move. The prior solver runtime optimization improved direct constrained drag solves, but pointer-only drawing preview still routes through full active-sketch display recomposition and solve work.

## What Changes

- Coalesce active sketch pointer movement so bursts of `sketch.pointerMoved` events produce at most one semantic preview update per animation frame.
- Avoid no-op sketch pointer state updates when there is no active sketch tool preview or the projected pointer has not meaningfully changed.
- Split active sketch display derivation into a stable solved basis and transient pointer/tool preview overlays so pointer-only preview movement does not re-solve the full sketch definition or rebuild static renderables.
- Preserve the existing warm-started interactive solve path for direct constrained drags and keep drag acceptance/blocking behavior unchanged.
- Switch viewport rendering away from unconditional continuous frames when idle, using explicit invalidation for camera controls, hover/selection, sketch preview, drag movement, renderable changes, section view, LOD changes, and camera transitions.
- Add focused regression coverage and instrumentation-oriented checks for sketch pointer/display behavior and idle viewport rendering.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sketch-geometry-editing`: active sketch pointer preview updates must be coalesced and must not run full solve/display derivation for unchanged static sketch geometry.
- `viewport-authoring-feedback`: viewport authoring feedback must remain live while using demand-driven rendering instead of continuous idle rendering.

## Impact

- Affected code includes sketch pointer routing in the editor event loop, sketch session preview state, active sketch display renderable derivation, workbench viewport renderable composition, and Three.js canvas render scheduling.
- The change should not alter persisted document formats, authored sketch operation schemas, OCC behavior, or feature-editing contracts.
- The implementation assumes feature editing may also benefit from idle rendering, but the root cause and required behavior target active sketch editing first.
