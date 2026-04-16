## Why

Existing authored work is not reopened through the most direct interactions, and `Escape` does not unwind authoring state the way users expect. Double-clicking a feature or sketch should reopen it for editing in place, and keyboard dismissal should first clear the active tool before leaving sketch mode entirely.

## What Changes

- Support double-click reopening of committed features so the feature form opens with the current committed values hydrated into the edit session.
- Support double-click reopening of committed sketches so the sketch editor resumes on that sketch in place.
- Make `Escape` deactivate any active tool first.
- Make `Escape` exit the current sketch session when no tool is selected inside a sketch.

## Capabilities

### New Capabilities
- `workbench-in-place-editing`: Double-click reopen flows for existing features and sketches so authoring resumes in place with hydrated state.

### Modified Capabilities
- `sketch-entry-parity`: Sketch reopen and keyboard exit behavior changes so reopened sketches and sketch escape flows remain consistent across entry points.

## Impact

- Affected code includes feature tree or object row interactions, feature-session and sketch-session hydration flows, and keyboard handling in the editor runtime.
- Likely requires focused tests for double-click reopen behavior and scoped `Escape` handling.
