## Context

The current export flow is provider-based for body geometry: registered providers expose format metadata and option schemas, the export modal lists every registered provider, and the orchestrator calls a provider with a `DurableRef` plus body-oriented capabilities. That shape is good and should stay, but it has two gaps for sketch export:

- providers do not advertise which target kinds they support, so the modal cannot know that sketch rows should only offer sketch-native formats;
- `ExportCapabilities` currently exposes mesh and B-Rep body services, with no sketch-vector extraction surface for SVG or DXF providers.

Sketches already have durable `SketchRef` targets, document-history rows for committed sketches, and authored SVG style state from Fill/Stroke tools. The implementation should reuse those durable seams rather than creating a separate "download sketch" command path.

## Goals / Non-Goals

**Goals:**

- Export committed sketches as `.svg` and `.dxf` through the existing export modal and download flow.
- Make provider availability target-aware so sketch rows expose only SVG/DXF and body rows keep body-compatible formats.
- Preserve authored SVG sketch style data in SVG output, including supported fill, stroke, stroke width, opacity, and gradient data.
- Add the same Export modal entry point to committed sketch history context menus.
- Keep export generation testable at domain/contract seams without requiring browser downloads for payload correctness.

**Non-Goals:**

- Export sketch-local operation rows, selected individual edges, or selected regions as separate files.
- Add body-to-SVG or body-to-DXF projection/export.
- Add new import support for SVG/DXF files.
- Add an "outline-only" SVG export mode; if authored SVG style data exists, SVG export includes the supported style data.
- Change existing STL, STEP, 3MF, or cadara export semantics for body rows.

## Decisions

### Target compatibility belongs on providers

Add a provider-level compatibility declaration such as `targetKinds` or `canExportTarget(target)` and expose registry helpers for compatible provider listing. The export modal should ask the registry for providers compatible with the selected target instead of knowing that `sketch` means `svg`/`dxf` and `body` means `stl`/`step`/`3mf`.

Alternative considered: hard-code sketch format filtering in `DocumentExportModal`. That is smaller initially, but it moves format policy into presentation code and would need repeated edits for every future target-specific format.

### Sketch vector export uses capabilities, not direct document spelunking by providers

Extend `ExportCapabilities` with a sketch-vector surface that can resolve a committed `SketchRef` into a normalized export model: sketch identity, label, plane-local coordinates, exportable entities, derived closed regions needed for fills, and authored style data. SVG and DXF providers should consume that model and return payloads; they should not import editor/session internals directly.

Alternative considered: let providers receive the full workspace snapshot and inspect sketches themselves. That would make providers powerful but would also couple file formats to document representation and sketch-session details.

### SVG export is styled by default when authored styles exist

SVG export should emit a colored/styled SVG whenever the sketch contains supported Fill/Stroke authored style data. The export should use the same canonical style resolution used by SVG sketch rendering where possible, but it should serialize portable SVG attributes/elements rather than viewport material details. Unsupported style fields should degrade with diagnostics and a documented fallback, not by dropping the export.

Alternative considered: add a modal toggle for styled versus plain SVG. That can be added later if users need it; the requested behavior is that applied SVG tools are reflected in the exported file.

### DXF export is geometry-first

DXF export should serialize sketch-local linework/curves in document units and preserve basic layer/color data only where it falls out naturally from the export model. Fill and gradient semantics are not required for DXF because they are SVG-specific in this request and DXF hatch/style fidelity can become a later capability.

Alternative considered: map every SVG fill to DXF hatch entities now. That adds format-specific complexity and edge cases without being necessary for the requested SVG style preservation.

### Context menus share one modal state path

Parts & Objects sketch export and document-history sketch export should both call the same modal-opening state builder with a `SketchRef` target. The history menu should not create a second modal or duplicate export orchestration.

Alternative considered: add a separate history-only export command. That would create two UI paths for the same export contract and make later changes to options/filtering easier to miss.

## Risks / Trade-offs

- [Risk] Sketch export can accidentally use active sketch draft state instead of the committed document revision. → Mitigation: export modal state captures `baseRevisionId`, and sketch-vector capabilities resolve against that document revision, matching existing export flow.
- [Risk] Provider target filtering can hide all formats if compatibility is misdeclared. → Mitigation: add domain/UI tests for body rows, sketch rows, and unsupported targets.
- [Risk] SVG style serialization can diverge from viewport rendering. → Mitigation: centralize style resolution into an exported pure helper consumed by both rendering and export where feasible; test exported SVG attributes from authored style records.
- [Risk] Region fills require valid closed-region boundaries; broken sketches may have style data but no exportable fill boundary. → Mitigation: export supported edge strokes, emit diagnostics for skipped fills, and keep the modal open only for fatal failures.
- [Risk] DXF curve support may lag advanced sketch entities. → Mitigation: support existing line/arc/circle/spline-compatible entities first, return diagnostics for unsupported entities, and keep partial export behavior explicit in provider results.

## Migration Plan

1. Extend export contracts with provider target compatibility and sketch-vector capabilities.
2. Add SVG and DXF providers to explicit built-in export-provider composition.
3. Implement sketch export-model derivation from committed sketch definitions, including style resolution for SVG export.
4. Update the export modal to filter providers by selected target and handle no-compatible-format diagnostics gracefully.
5. Wire Parts & Objects and document-history sketch Export actions into the shared modal-opening path.
6. Add focused logic/UI tests for provider filtering, SVG/DXF provider output, styled SVG serialization, and both sketch context-menu entry points.

Rollback is straightforward: remove the SVG/DXF providers from built-in composition and remove the sketch Export menu entry while leaving the target-compatibility contract in place for future formats if already useful.

## Open Questions

- Should DXF preserve stroke colors as layer colors in the first implementation, or remain pure geometry with default layers?
- Should SVG export include hidden sketch entities if the sketch row is hidden in the viewport? The proposed default is yes, because export targets committed document data rather than transient visibility state.
