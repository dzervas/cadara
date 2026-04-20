## Why

Sketch mode already has solver and annotation infrastructure for constraint authoring, but several common CAD constraints are missing from the toolbar/runtime flow. Adding these tools closes practical sketching gaps without changing the broader sketch interaction model.

## What Changes

- Add sketch constraint tools for Concentric, Midpoint, Normal, Pierce, Symmetric, and Fix Geometry.
- Use the existing SVG icon assets for the new constraint tools in toolbar and annotation surfaces.
- Author durable constraints or equivalent solver-backed sketch updates through the existing sketch constraint authoring flow.
- Add focused tests for tool registry exposure, target selection, durable commit payloads, solver effects, annotation glyphs, and invalid target rejection.

## Capabilities

### New Capabilities

- `sketch-constraint-tool-behavior`: Covers explicit behavior for the new sketch constraint tools, including target requirements, solver-backed commits, annotations, and tests.

### Modified Capabilities

None.

## Impact

- Affected domain code: `src/domain/tools/`, `src/domain/sketch-constraints/`, `src/domain/editor/sketch-session.ts`, and sketch contract/runtime-schema code if a missing durable constraint shape is required.
- Affected solver code: `src/contracts/sketch/solver-core.ts` and related solver tests only where the existing solver contract does not already expose a direct authored relationship.
- Affected UI code: toolbar icon asset mapping and sketch constraint annotation glyph mapping.
- Affected tests: sketch constraint registry/session specs, solver-core specs, runtime-schema specs, toolbar registry specs, and annotation rendering specs.
- No new runtime dependency is expected.
