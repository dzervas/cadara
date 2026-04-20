## Why

Many missing upstream-equivalent sketch tools are constructor variants over entities the sketch graph already supports. Adding them together keeps the work focused on tool interaction, live preview, and auto-authored constraints without expanding the durable entity contract.

## What Changes

- Add sketch-mode tools for point, midpoint line, center-point rectangle, aligned rectangle, 3-point circle, 3-point arc, tangent arc, center-point arc, inscribed polygon, and circumscribed polygon.
- Add dropdown/tool-family registration for related line, rectangle, circle, arc, and polygon variants.
- Commit auto-authored constraints and dimensions where the construction intent must survive later edits.
- Preserve construction-mode authoring, snap-derived constraints, undo/redo, and active sketch session behavior for all new constructors.

## Capabilities

### New Capabilities
- `sketch-primitive-constructor-tools`: Sketch-mode primitive constructor tools that produce existing durable entity kinds plus durable construction intent.

### Modified Capabilities

## Impact

- Affects `src/domain/sketch-tools/`, tool registry/toolbar presentation, sketch session commit handling, icon metadata, sketch inferred constraints, and sketch tool tests.
- Depends on existing entity kinds only; it does not depend on `expand-durable-sketch-entities`.
- Later edit and transform changes can reuse the entities and constraints authored here.
