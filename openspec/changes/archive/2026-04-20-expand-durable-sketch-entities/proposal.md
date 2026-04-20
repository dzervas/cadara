## Why

The sketch system currently has durable support for points, lines, circles, arcs, and fit-point splines, but several upstream-equivalent sketch tools require entities that cannot be represented without lossy approximation. This change expands the sketch contract first so later tool work can commit real ellipse, conic, Bezier, and profile-generating text entities instead of static primitive approximations.

## What Changes

- Add first-class durable sketch entity kinds for ellipse, elliptical arc, conic, Bezier curve, and profile-generating text.
- Extend sketch runtime validation, persistence, snapshot hydration, solver output, viewport renderables, and profile extraction to understand the new entity families.
- Preserve authored point/reference relationships for the new entities so downstream tools and later transform/pattern work can address them durably.
- Keep tool authoring out of this change except for fixtures and contract examples required to validate the new entity records.

## Capabilities

### New Capabilities
- `sketch-expanded-entity-contract`: Durable sketch contract support for advanced curve and profile-generating text entity kinds.

### Modified Capabilities

## Impact

- Affects `src/contracts/sketch/`, sketch runtime schemas, solver snapshot records, modeling persistence, OCC sketch/profile conversion, viewport renderable derivation, and sketch history/icon mapping.
- Enables the later `add-sketch-advanced-curve-text-tools` change.
- May require migration-safe handling for existing sketches that only contain the current entity kinds.
