## Why

Sketch drawing feedback currently reads like a detached feature editor instead of part of the geometry being created. Users need live dimensions and numeric entry near the active sketch geometry so they can author shapes without looking away from the viewport.

## What Changes

- Replace panel-style sketch drawing feedback with geometry-anchored viewport labels and inputs.
- Show circle diameter/radius labels near the active circle edge while creating circles.
- Show rectangle width and height labels near the corresponding edges while creating rectangles.
- Show line length and angle labels near active line geometry where applicable.
- Keep generic sketch tool presentation descriptors as the source of UI data rather than introducing per-tool React branches.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sketch-tool-editor-schema`: The schema must express geometry-anchored live measurements and floating inputs.
- `viewport-authoring-feedback`: The viewport must render active sketch drawing feedback near the authored geometry.

## Impact

- Affected areas include sketch tool presentation descriptors, viewport overlay rendering, sketch floating input placement, and tests for line/rectangle/circle authoring feedback.
- No durable modeling schema changes are expected.
- This change does not add direct editing or constraint authoring preview logic.
