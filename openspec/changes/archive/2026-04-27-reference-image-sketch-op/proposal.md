## Why

Raster image handling is currently split across generic sketch geometry, the sketch solver, and the part-mode import flow, which makes the feature hard to reason about and easy to extend poorly. This change replaces that patchwork with one sketch-native `referenceImage` operation that owns its own persisted image data and committed rendering.

## What Changes

- **BREAKING** Remove the current raster-image path built around `imageReference` sketch entities, `pointOnImage` constraints, image pin placement, and the generic image import provider.
- Add a sketch-mode `Import Image` tool that creates a committed `referenceImage` operation inside the active sketch instead of routing raster images through the part-mode import workflow.
- Persist reference images inline in the sketch document as base64 image payloads with image metadata rather than through the current embedded-binary asset indirection.
- Define default placement for newly imported reference images as centered on the active sketch plane with a reasonable initial extent and no calibration requirements.
- Support multiple committed reference-image operations inside one sketch, each with independent identity, history rows, selection, rendering, and deletion behavior.
- Keep this change strictly limited to committed image-operation persistence, rendering, and history. Calibration editing is deferred to a separate change.

## Capabilities

### New Capabilities
- `reference-image-sketch-op`: sketch-native reference-image operations with inline image payload persistence, default placement, committed rendering, and multi-image history behavior

### Modified Capabilities
- `sketch-authoring-operations`: allow explicitly approved sketch operations to own persisted non-graph payloads instead of requiring all operation semantics to collapse into flat sketch graph metadata
- `import-toolbar-and-session`: remove raster reference-image creation from the generic part-mode import workflow and reserve that workflow for non-sketch-reference imports
- `image-import-provider`: remove the raster image import-provider requirements that currently create image-backed sketches through the generic import system
- `image-reference-sketch-entity`: remove the requirement that reference images be represented as ordinary sketch entities with corner points and structural constraints
- `image-calibration-constraint`: remove the current image-specific solver-constraint model tied to `pointOnImage`
- `image-pin-placement`: remove the current click-to-create image-pin flow built on `pointOnImage`

## Impact

- Affected areas include sketch contracts and runtime schemas, sketch-session history/persistence, sketch rendering and picking, sketch-mode toolbar actions, and the generic import pipeline.
- The change removes the current image-specific coupling to the sketch solver and to the document embedded-binary asset registry for reference images.
- Follow-on changes will build calibration editing and anchor export on top of the new operation contract rather than reintroducing image behavior into the generic sketch graph.
