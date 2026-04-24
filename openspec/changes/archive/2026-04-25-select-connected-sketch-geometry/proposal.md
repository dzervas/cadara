## Why

Sketch editing currently supports selecting individual geometry, but users need a faster way to operate on a continuous chain or closed loop. Double-clicking a sketch edge should select the whole connected run so common shapes such as two joined lines or rectangle outlines can be manipulated without repeated individual picks.

## What Changes

- Add sketch-mode double-click selection for connected editable local sketch geometry.
- Define connected geometry as sketch entities reachable through shared sketch points in the active sketch definition.
- Select the entire connected component when the user double-clicks any editable edge or curve in that component.
- Preserve existing single-click selection, projected reference behavior, and active drawing/constraint tool routing.
- Treat closed loops, including rectangle edges, as ordinary connected components rather than special-casing constructor metadata.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sketch-geometry-editing`: active sketch selection now includes double-click expansion from one editable sketch entity to all connected editable local entities.

## Impact

- Affected areas include viewport double-click routing, sketch entity selection state, connected-component derivation over the active sketch definition, and tests for sketch-mode selection behavior.
- No new runtime dependencies are expected.
- The change should not alter solver input, sketch persistence schemas, or authoring operation metadata.
