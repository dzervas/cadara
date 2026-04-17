## Why

Sketch mode has basic usability gaps that block deeper sketch work: some toolbar icons are too dark to read, and active constraint tools can receive hover feedback without receiving click selections. These issues should be repaired before investing in richer viewport-native sketch feedback.

## What Changes

- Ensure sketch-mode toolbar tools render with visible light foreground/icon treatment on the dark workbench shell.
- Route viewport clicks to active sketch constraint workflows when the hovered/picked target is valid for the active constraint tool.
- Preserve existing sketch drawing pointer-release behavior while allowing selection events for constraint tools.
- Keep annotation delete/backspace behavior available for committed constraint and dimension targets.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `toolbar-tool-presentation`: Toolbar foreground and icon treatment must remain visible in sketch mode.
- `viewport-authoring-feedback`: Viewport selection dispatch must work for active sketch constraint tools, not only idle selection.
- `sketch-constraint-authoring`: Constraint authoring must accept viewport-selected sketch geometry while the constraint tool is active.

## Impact

- Affected areas include toolbar icon/button presentation, viewport click routing, editor selection dispatch, and sketch constraint authoring tests.
- No schema or persistent document changes are expected.
- This change intentionally does not redesign sketch overlays, geometry editing, or constraint preview rendering.
