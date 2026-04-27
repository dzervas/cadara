## Context

The current raster image workflow is spread across the generic part-mode import system, sketch-local `imageReference` entities, image-specific solver constraints, and image-pin authoring behavior. That structure leaks implementation details into the sketch graph, makes image behavior difficult to reason about, and encourages future edits to thread image-specific exceptions deeper into the generic sketch editor.

This change establishes a new source of truth: a committed `referenceImage` sketch operation that owns its own persisted image payload and placement state. The operation exists as committed sketch state, not as a disguised bundle of ordinary sketch entities and solver constraints.

## Goals / Non-Goals

**Goals:**
- Replace the current raster-image model with a single sketch-native `referenceImage` operation contract.
- Persist image bytes inline in the sketch document as base64 plus image metadata.
- Keep imported reference images out of the generic sketch solver and out of local sketch graph records.
- Support multiple reference-image operations per sketch with clean history, rendering, selection, and deletion semantics.
- Remove the old raster image provider/entity/pin/constraint path in the same change rather than carrying both systems in parallel.

**Non-Goals:**
- Implement image calibration workflows.
- Export anchor points or other image-owned reference geometry into the main sketch.
- Preserve backward compatibility with the current pre-alpha image document shape.
- Route reference-image creation through the existing part-mode import inspector.

## Decisions

### 1. `referenceImage` becomes the new persisted source of truth

The new operation will persist image metadata and payload directly on the operation record instead of manufacturing local sketch points, edges, and constraints.

Why:
- It removes the false equivalence between a raster image and ordinary sketch geometry.
- It keeps later calibration logic out of the main sketch solver.
- It gives one durable identity for rendering, picking, deletion, and later dedicated editing.

Alternative considered:
- Keep the current `imageReference` entity and just wrap it in a nicer UI.
- Rejected because it preserves the same hidden coupling between raster images and the generic sketch graph.

### 2. Reference images use inline base64 sketch-document persistence

Reference-image operations will store the image media type, optional file name, pixel dimensions, and base64 payload inline in the sketch document instead of using the current embedded-binary asset indirection.

Why:
- The image is owned by one sketch operation, so operation-local persistence is a clearer fit than document-global asset indirection.
- The user explicitly wants image bytes in the sketch document.
- It removes the need to maintain a parallel binary registry just for tracing images.

Alternative considered:
- Keep document-level embedded binary asset storage and reference it from the operation.
- Rejected because it keeps image ownership split across two persistence models.

### 3. Raster reference-image import becomes sketch-owned, not part-import-owned

The new `Import Image` action will exist only while editing a sketch and will create a committed `referenceImage` operation directly in that sketch.

Why:
- Reference images are sketch context, not part workspace assets.
- It avoids pushing tracing-specific UX through the generic import inspector.
- It keeps the normal part-mode import button focused on part-level imports.

Alternative considered:
- Continue using the generic import provider flow and commit a reference-image op from there.
- Rejected because it preserves an unnecessary orchestration layer and keeps image behavior coupled to the part-mode import workflow.

### 4. Rendering and picking are derived from the committed operation

Committed reference images will produce their own renderables and pick targets from the operation payload and placement state. They will not be represented as local sketch entities to reuse existing local-geometry render paths.

Why:
- Rendering must stay aligned with the new operation-owned source of truth.
- Picking needs operation identity, not synthetic point/entity IDs.
- This keeps the door open for later dedicated editors without reintroducing graph hacks.

Alternative considered:
- Synthesize hidden local sketch entities solely for rendering/picking.
- Rejected because it recreates the original abstraction leak in a different place.

### 5. New code lives in dedicated reference-image modules

The implementation should introduce dedicated contracts and domain modules for reference-image operations rather than scattering logic through generic sketch files.

Recommended structure:
- `src/contracts/reference-image/` for persisted payload and runtime validation
- `src/domain/reference-image/operations/` for authoring/history mutation helpers
- `src/domain/reference-image/rendering/` for committed renderables and pick targets

Why:
- The user explicitly asked for clean structure and no shortcuts that lead to spaghetti.
- Concentrating image-op logic in one module family makes later calibration changes additive instead of invasive.

## Risks / Trade-offs

- [Breaking existing image documents] → Accept the break explicitly and remove the old path in one change instead of building translation shims.
- [Inline base64 increases sketch payload size] → Accept that trade-off because tracing images are operation-owned and the structural simplification is more important in pre-alpha.
- [Removing the part-import image path may temporarily reduce import UX reuse] → Keep the sketch `Import Image` flow intentionally narrow and defer any broader import abstraction reuse until a real second use case appears.
- [Rendering/picking path divergence from local sketch geometry] → Keep reference-image rendering isolated in dedicated modules with explicit contracts instead of blending it into generic local-geometry code.

## Migration Plan

- Introduce the new `referenceImage` operation contracts and rendering path.
- Add the sketch-mode `Import Image` tool and direct file-selection flow.
- Move raster-image creation to the new operation path.
- Remove the current image import provider, image entity, image pin, and image calibration constraint code in the same rollout.
- Update tests and fixtures to use the new operation contract only.

## Open Questions

- None for this change. Calibration behavior, anchor exports, and image editing flows are deliberately deferred to later changes.
