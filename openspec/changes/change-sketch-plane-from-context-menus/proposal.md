## Why

Committed sketches can already be reopened for continued sketch authoring, but there is no direct way to retarget a sketch to a different origin plane without rebuilding it. That gap is awkward now that sketches appear as first-class items in both `Parts & Objects` and the bottom history bar, because both surfaces imply sketch-level editing actions but neither exposes plane reassignment.

Assumption: this change covers reassigning a committed sketch to another supported origin datum plane (`XY`, `YZ`, `XZ`) through the existing inspector/editor workflow. It does not expand sketch support editing to arbitrary planar faces unless implementation discovery shows the current contracts already make that safe.

## What Changes

- Add a sketch-specific `Change Sketch Plane` action to committed sketch context menus in `Parts & Objects`.
- Add the same `Change Sketch Plane` action to committed sketch context menus in the bottom history bar.
- Open a sketch plane edit session in the existing inspector/editor surface instead of reopening the full sketch authoring session.
- Let that edit session show the current origin plane, allow choosing a different supported origin plane, and persist the accepted change back onto the committed sketch.
- Keep the normal sketch `Edit` action unchanged so continued sketch authoring and plane reassignment remain separate flows.

## Capabilities

### New Capabilities
- `sketch-plane-reassignment`: Reassign a committed sketch to a different supported origin plane through an inspector-backed edit flow that preserves the sketch as a durable document item.

### Modified Capabilities
- `workbench-context-menus`: Sketch rows in `Parts & Objects` and committed sketch history rows gain a `Change Sketch Plane` action that opens the dedicated plane reassignment flow.
- `feature-timeline-bar`: The bottom history bar context-menu parity contract expands so committed sketch items expose `Change Sketch Plane` alongside the existing shared history actions.

## Impact

- Affected systems include workbench context-menu action wiring, history-bar menu helpers, inspector/editor session orchestration, and sketch commit/update flows.
- The change likely touches sketch edit-session hydration and commit logic because plane reassignment must update the committed sketch's stored plane without routing through the normal feature edit path.
- No external API changes are expected, but document mutation and UI session contracts for committed sketches will expand.
