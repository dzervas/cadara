## 1. Export Contract and Registry

- [x] 1.1 Extend `ExportProvider` with target compatibility metadata or a compatibility predicate that can distinguish body and committed sketch targets.
- [x] 1.2 Extend `ExportProviderRegistry` with compatible-provider listing and compatible format lookup helpers.
- [x] 1.3 Extend `ExportCapabilities` with a sketch-vector capability that resolves committed sketch targets into an export model containing geometry, regions, units, and authored style data.
- [x] 1.4 Update the export orchestrator to reject incompatible provider/target pairs before invoking providers.

## 2. Sketch Vector Export Model

- [x] 2.1 Implement a pure sketch export-model builder for committed sketches using sketch-local coordinates and document revision data.
- [x] 2.2 Include supported line, arc, circle, spline/curve-compatible entities in the export model, with diagnostics for unsupported entity kinds.
- [x] 2.3 Include closed-region boundary data needed for styled SVG fills.
- [x] 2.4 Centralize supported authored SVG style resolution so SVG export can consume the same persisted style semantics as sketch rendering without depending on viewport materials.

## 3. SVG and DXF Providers

- [x] 3.1 Add a built-in SVG export provider compatible with committed sketch targets.
- [x] 3.2 Serialize SVG geometry with a valid root, viewBox, sketch-local coordinates, and supported authored stroke/fill/opacity/gradient attributes.
- [x] 3.3 Add a built-in DXF export provider compatible with committed sketch targets.
- [x] 3.4 Serialize DXF geometry from the sketch export model and report unsupported geometry diagnostics without silently dropping unrelated supported geometry.
- [x] 3.5 Register SVG and DXF providers through explicit built-in export-provider composition.

## 4. Export Modal and Context Menus

- [x] 4.1 Update `DocumentExportModal` to list only providers compatible with the selected target and choose an initial format from that filtered list.
- [x] 4.2 Ensure Parts & Objects sketch rows open the export modal with only SVG and DXF available.
- [x] 4.3 Add Export to committed sketch document-history context menus and route it through the same modal state path as Parts & Objects export.
- [x] 4.4 Preserve existing body export behavior and existing body-compatible format options.

## 5. Tests and Validation

- [x] 5.1 Logic lane: add provider-registry and orchestrator tests for target compatibility filtering and incompatible target rejection.
- [x] 5.2 Logic lane: add sketch export-model tests for committed sketch geometry, unsupported entity diagnostics, and region/style extraction.
- [x] 5.3 Logic lane: add SVG provider tests proving styled stroke/fill/opacity/gradient serialization from authored sketch style data.
- [x] 5.4 Logic lane: add DXF provider tests proving non-empty DXF output and unsupported geometry diagnostics.
- [x] 5.5 UI lane: update export modal and context-menu tests for sketch-only SVG/DXF options in Parts & Objects and document-history entry points.
- [x] 5.6 Run `bun run test:all` and fix any failures introduced by this change.
