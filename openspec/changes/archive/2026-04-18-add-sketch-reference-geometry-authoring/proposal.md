## Why

Sketches currently behave as isolated authored graphs even though the contract already has external reference and projection types. Users need a first-class way to reference model topology and existing sketch geometry from an active sketch before smart snapping or reference-aware constraints can be implemented safely.

## What Changes

- Add an explicit sketch reference/project workflow that authors `SketchReferenceDefinition` records for supported external sources.
- Resolve authored references through the sketch solver projection boundary and render the resulting projected geometry as read-only sketch reference geometry.
- Make projected reference geometry hoverable and selectable while editing the owning sketch.
- Preserve reference records and projection diagnostics across sketch commit, reload, and re-entry.
- Keep projected reference geometry out of profile boundary generation in this change.

## Capabilities

### New Capabilities
- `sketch-external-reference-geometry`: Defines durable sketch reference authoring, projection, display, selection, and invalidation behavior.

### Modified Capabilities
- `frontend-modeling-boundary`: Durable sketch reference creation and deletion are modeling actions routed through the frontend-facing modeling boundary.
- `sketch-geometry-editing`: Active sketch editing can include selectable read-only projected reference geometry in addition to local authored geometry.

## Impact

- Affected areas: sketch contract normalization, sketch session/editor state, modeling service sketch commit flow, solver projection adapter calls, viewport renderables and picking, selection catalog behavior, and focused `bun:test` coverage.
- No new runtime dependency is expected.
- This change intentionally blocks later reference-aware constraints, snap inference, inferred constraints, and projected-profile-boundary work.
