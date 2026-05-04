## Why

Sketches are first-class CAD artifacts, but the current export flow is centered on solid bodies and exposes body-oriented formats even when the selected row is a sketch. Users need sketch-native SVG and DXF export for laser/CNC/2D workflows, and styled SVG sketches must preserve the authored fill/stroke presentation instead of degrading to plain outlines.

Assumption: sketch export targets committed sketches as selected from Parts & Objects or document history; sketch-local operation rows are not standalone export targets.

## What Changes

- Add sketch export providers for SVG and DXF that produce vector payloads from committed sketch definitions.
- Extend the export provider contract so providers can declare compatible target kinds and the export modal can filter formats by the selected target.
- Update the Parts & Objects export flow so sketch rows show only SVG and DXF in the existing export modal.
- Add Export to the document history context menu for committed sketch history items, opening the same export modal scoped to that sketch.
- Ensure SVG export includes authored SVG sketch styles when fill/stroke style tools have been applied, including relevant stroke, fill, width, opacity, and supported gradient data.
- Keep body export behavior unchanged: body rows continue to expose existing body-compatible formats through the same modal.

## Capabilities

### New Capabilities
- `sketch-vector-export`: Defines SVG and DXF export generation from committed sketch definitions, including styled SVG output.

### Modified Capabilities
- `document-export`: The export modal must filter available file types by target compatibility and support sketch-scoped SVG/DXF exports.
- `export-provider-contract`: Export providers must advertise target compatibility and receive sketch-vector capabilities without reaching into sketch internals directly.
- `workbench-context-menus`: Sketch rows and sketch history items must expose Export actions that open the same export modal; sketch rows must not offer body-only export formats.
- `svg-sketch-style-behavior`: Authored SVG sketch styles must be available to SVG export and preserved in exported SVG output.

## Impact

- Affected specs: `document-export`, `export-provider-contract`, `workbench-context-menus`, `svg-sketch-style-behavior`, and new `sketch-vector-export`.
- Affected code likely includes `src/contracts/export/**`, `src/domain/export/**`, `src/components/layout/document-export-modal.tsx`, `src/components/layout/parts-object-menu.helpers.tsx`, `src/components/layout/feature-timeline-bar*.ts`, `src/app/workbench/cad-workbench.tsx`, and sketch presentation/style extraction helpers under `src/contracts/sketch/**`, `src/domain/editor/**`, or `src/core/sketch-*`.
- Tests should cover provider target filtering, sketch SVG/DXF payload generation, style-preserving SVG output, and both context-menu entry points at the smallest owning seams.
