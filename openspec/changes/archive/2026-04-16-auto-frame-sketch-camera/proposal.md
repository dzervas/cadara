## Why

Sketch entry currently preserves whatever camera orientation and zoom happened to be active before entering the sketch. That makes new-sketch authoring start from arbitrary viewpoints and makes editing an existing sketch cumbersome when geometry is off-screen.

## What Changes

- Re-orient the camera on sketch entry so the view direction is parallel to the active sketch reference plane.
- Fit the camera to authored sketch geometry when editing an existing sketch so the full sketch is visible on entry.
- Fall back to a plane-centered framing strategy when creating a new sketch with no authored geometry yet.
- Keep camera updates scoped to sketch-open flows so normal part-mode navigation remains unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities
- `sketch-plane-alignment`: Sketch session entry now aligns and frames the camera against the active sketch plane.

## Impact

- Affected code includes sketch-open orchestration, viewport camera control helpers, and sketch bounds computation.
- Likely requires integration coverage for sketch create and sketch edit entry flows across `XY`, `YZ`, and `XZ` planes.
- No changes to sketch persistence schema or modeling kernel semantics.
