## Why

The viewport currently communicates the wrong visual and interaction signals during authoring. Solid and region shading reads as half-dark and blue-tinted, vertices are oversized and styled differently from edges, and hover or selection does not reliably work for line- and edge-backed geometry, which makes sketching and topology picking harder than it should be.

## What Changes

- Normalize viewport materials so solid objects render as opaque off-white surfaces and sketch or profile regions render as faint cyan fills.
- Reduce vertex marker size and align vertex base color with the line and edge color used for wire geometry.
- Restore reliable hover and selection for edges, lines, and vertices.
- Apply a mild orange hover treatment to lines, edges, and vertices so interactive targets are readable without overwhelming the scene.

## Capabilities

### New Capabilities
- `viewport-authoring-feedback`: Visual styling and interaction feedback for solids, regions, edges, lines, and vertices in the workbench viewport.

### Modified Capabilities

## Impact

- Affected code includes viewport render-style helpers, Three.js scene assembly, raycast/picking bindings, and hover or selection state mapping.
- Likely requires test coverage for renderable styling and topology-target interaction in viewport-focused integration or e2e flows.
- Does not change modeling-kernel geometry semantics or document persistence contracts.
