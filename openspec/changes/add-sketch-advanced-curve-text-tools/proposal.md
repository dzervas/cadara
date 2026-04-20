## Why

After advanced sketch entities exist in the durable contract, users need sketch-mode tools that author those entities directly. This change adds upstream-equivalent curve and text tools without flattening their authored intent into lower-level approximations.

## What Changes

- Add sketch-mode tools for ellipse, elliptical arc, conic, Bezier curve, spline control-point mode, and profile-generating text.
- Commit first-class durable entity records introduced by `expand-durable-sketch-entities`.
- Add live preview, validation, measurements, and generic presentation schema coverage for the new workflows.
- Preserve construction authoring, style behavior, selection targets, undo/redo, and profile-generating text semantics.

## Capabilities

### New Capabilities
- `sketch-advanced-curve-text-tools`: Sketch-mode tools for authoring advanced curve and profile-generating text entities.

### Modified Capabilities

## Impact

- Depends on `expand-durable-sketch-entities`.
- Affects `src/domain/sketch-tools/`, sketch session commit factories, viewport feedback, tool icon metadata, profile extraction fixtures, and sketch tool tests.
- May require small extensions to the generic sketch tool presentation schema for text and control-point interactions.
