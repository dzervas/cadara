## Context

Sketch SVG styling already has toolbar entries, style control descriptors, authored style fields, and viewport renderable support. The current shape is too eager and too fragmented: style focus can appear while the user is simply editing a sketch, fill type and stroke variants are exposed as separate SVG tools, and style target handling is centered on point/entity selections even though region records are already derived in real time.

The sketch contract already separates authored sketch input from derived regions, but it also supports authored `SketchStyleRecord` targets for entities and regions. This change should use that existing contract instead of persisting derived region geometry as authored sketch input.

## Goals / Non-Goals

**Goals:**

- Add an explicit per-sketch SVG rendering toggle that controls whether authored fill/stroke styles affect viewport renderables.
- Persist the toggle with the sketch document data and default missing data to rendering enabled for compatibility with existing styled sketches.
- Make the toolbar-visible SVG tool set only `Fill` and `Stroke`, with fill type and stroke options rendered inside those focused forms.
- Ensure `Fill` works against solver-derived enclosed regions and rejects point/edge/entity targets.
- Ensure `Stroke` works against sketch edges/entities and rejects region targets.
- Stop implicit Fill focus when entering or editing a sketch; SVG style forms open only from explicit toolbar activation.

**Non-Goals:**

- No new rendering engine, material system, or external dependency.
- No persistence of derived region geometry as primary sketch input.
- No SVG export or import expansion beyond the existing style fields.
- No broad toolbar redesign outside the SVG style controls.

## Decisions

1. Store SVG render visibility as sketch-owned document state.

   The toggle belongs to the sketch because the user asked for per-sketch persistence and rendering behavior must survive commit, reopen, and document round trip. The implementation should add an optional schema field or sketch metadata value with a compatibility default of enabled when absent. Alternative considered: keep it only in UI/runtime state. That would be simpler, but it would not satisfy per-sketch document persistence.

2. Keep authored styles while suppressing rendering.

   Turning SVG rendering off should remove fill/stroke style effects from active sketch renderables, but it must not clear `SketchStyleDefinition` values or `SketchStyleRecord` entries. Alternative considered: disable the style tools by clearing authored style values. That is destructive and would make the toggle unsafe.

3. Use region style records for Fill.

   `Fill` should target `RegionRecord.target` values from the live region solver and author/update a region-scoped style record. The editor must not author the region geometry itself; it only stores style keyed to the stable region id already exposed by the solver. Alternative considered: apply fill to every boundary entity around the region. That makes the filled area ambiguous for holes and overlapping regions and does not match the user's "Fill only accepts regions" requirement.

4. Use edge/entity style for Stroke.

   `Stroke` should target sketch edge/entity refs and patch their stroke fields. Region targets should be ignored with target-selection guidance. Alternative considered: let Stroke apply to region boundaries. That introduces a second way to modify the same edge visuals and weakens the "Stroke only accepts edges" rule.

5. Collapse style variants into forms, not toolbar tools.

   The tool registry and toolbar should expose only `fill` and `stroke` as SVG style tools. Fill mode, gradient colors, stroke enablement, width, cap, join, miter, and dash controls remain in the sketch tool editor schema as controls inside those two focused forms. Alternative considered: keep hidden tool ids for all variants. If retained for migration or shortcuts, they must not appear as toolbar-visible SVG tools or auto-focus style forms.

## Risks / Trade-offs

- Region ids can change after topology edits → style records for missing regions should remain harmless and not crash rendering; implementation should preserve data and only render styles for currently resolved matching regions.
- Defaulting missing toggle data to enabled preserves existing visuals but means new sketches may initially show SVG rendering controls as available → product default can be changed during implementation if desired without changing the persisted per-sketch contract.
- Removing toolbar-visible variant tools can affect existing tests or shortcuts → update toolbar/search expectations deliberately and keep action handling tolerant of legacy ids only if current code paths require it.
- Fill and Stroke now have different target kinds → shared style helper types need to be adjusted carefully so UI components remain generic and target validation stays in domain/runtime code.
