## Context

The `Measure` tool is already present in [`src/domain/tools/tool-registry.ts`](/app/src/domain/tools/tool-registry.ts:240), but part-mode toolbar actions still only fan out through shared tool events and logging subscribers instead of a real measurement workflow. The existing editor runtime already has the core shape needed for a temporary inspect tool:

- `selectionCommand` sessions handle transient command-owned selection without durable document mutations.
- `getSelectionFilterForCommand()` already specializes temporary inspect/start flows such as `Section View`.
- the bottom-left `WorkbenchStateDebugger` is already the established viewport-adjacent location for dense runtime readouts.

This change is cross-cutting because it touches tool activation, selection filtering, geometry/measurement resolution, viewport feedback renderables, and a new debugger-adjacent presentation surface.

Assumptions:

- Measure remains a part-mode inspection tool for this change.
- Results stay transient and selection-driven; no measurement is written into the document model.
- Exact values should be used when the geometry source can provide them; spline and other sampled curve metrics may need a documented approximation path if analytic data is unavailable at the UI boundary.

## Goals / Non-Goals

**Goals:**

- Turn `Measure` into a real runtime-owned inspect workflow instead of a no-op log action.
- Support one-target and two-target measurement inspection with meaningful readouts for bodies, faces, edges, vertices, arcs, circles, and splines.
- Show measurement readouts in a compact panel to the right of the state debugger and omit any field that does not apply to the current selection.
- Render retained measurement feedback in the viewport as a bright yellow emphasized line/curve with a soft halo.
- Clear stale measurement feedback whenever the selection is replaced, cleared, or the tool exits.

**Non-Goals:**

- Durable dimension authoring, annotation persistence, or solver-backed constraints.
- A general redesign of the state debugger itself.
- Unit-system changes beyond reusing the current project formatting conventions.
- Sketch-mode measurement authoring or arbitrary multi-target measurement sets larger than the active one- or two-target selection.

## Decisions

1. Model `Measure` as a `selectionCommand` with a dedicated selection filter instead of inventing a separate runtime state kind.

   `Section View` already proves that temporary inspect tools should be runtime-owned. For Measure, the simpler path is to keep the existing `selectionCommand` shape and add a `measureSelectionFilter` that accepts measurable geometry and supports one-target and two-target combinations. The command phase can remain `collecting`; the rendered output is derived from the current selection rather than from a bespoke command sub-state.

   Alternative considered: add a new `inspectingMeasure` state with its own transitions. That would duplicate existing selection-command behavior without buying much, because Measure does not need an editing/manipulation phase like Section View.

2. Compute a derived measurement view model from `activeCommand + selection + snapshot`, not durable editor state.

   Measurement rows and retained highlight geometry should be computed from the active tool id, current selected targets, and current geometry data. This keeps cleanup simple: disabling the tool, clearing selection, or replacing the selection automatically removes stale measure output because the derived model becomes empty.

   Alternative considered: store resolved measurement values and highlight geometry directly in editor state. That would make the state machine heavier, require more invalidation paths, and create avoidable duplication with source geometry.

3. Introduce a measurement-resolution boundary in `src/domain/measure/` that returns both readout descriptors and viewport feedback descriptors.

   The UI should not know how to measure an arc, decide whether a spline value is exact vs sampled, or derive a shortest-distance witness segment between two topology targets. A dedicated domain layer should accept the active selection plus document/runtime geometry and return:

- compact measurement rows ready for presentation
- visibility metadata for optional fields
- one or more highlight/witness geometries for the viewport
- selection summary text when a combination is unsupported or partially measurable

   Alternative considered: let the panel and viewport renderer each inspect snapshot/renderable data independently. That would duplicate geometric logic and make pairwise measurement parity hard to test.

4. Keep the measurement panel separate from the state debugger component, but anchor it in the same bottom-left overlay zone.

   The debugger spec says the debugger remains presentational and owns workbench state readouts. Measure readouts are a separate tool surface that happens to live adjacent to it. The clean implementation is a sibling overlay component that reads the derived measurement model and positions itself immediately to the right of the debugger footprint.

   Alternative considered: add measure-specific rows directly into `WorkbenchStateDebugger`. That would mix generic runtime debugging with tool-specific inspection output and would make future debugger reuse harder.

5. Render the bright yellow retained line with a layered highlight instead of a global post-processing bloom pass.

   A soft blur request is better met with a local halo treatment than with full-scene post-processing. The viewport should render measurement feedback as a bright yellow core line plus one or more wider translucent yellow passes using the same geometry, so the measured line reads thicker than normal and lightly glows without imposing a new global compositor.

   Alternative considered: add a bloom/postprocessing dependency for the entire viewport. That is broader, riskier, and unnecessary for a single temporary overlay effect.

6. Normalize measurement behavior around one-target properties plus two-target pairwise distance.

   Single-target selection should expose intrinsic properties such as edge length, face area, body volume, arc sweep, circle diameter, or spline length. Two-target selection should add pairwise metrics such as minimum distance and the corresponding witness geometry when that combination is supported. If the user clicks a fresh target after already building a pair, the tool should replace the prior pair with a new single-target measurement set.

   Alternative considered: support open-ended accumulation of many targets. That would complicate the UI, command semantics, and witness rendering far beyond the current request.

## Risks / Trade-offs

- Exact measurement data may not be available from every currently exposed frontend geometry source, especially for splines and some pairwise topology queries. → Resolve through a dedicated measurement boundary that prefers exact topology/kernel data and falls back to consistent sampled approximations only where necessary.
- Pairwise distance across faces, edges, and mixed target kinds can expand quickly in scope. → Constrain the first version to minimum-distance-style pair measurements and explicit unsupported-combination messaging instead of ad hoc special cases.
- The debugger-adjacent panel can crowd the bottom-left viewport corner on smaller screens. → Keep the panel compact, suppress empty rows, and let it collapse to content rather than reserving a fixed large surface.
- A thicker glowing line can visually compete with normal selection/hover accents. → Reserve the bright yellow/halo treatment exclusively for the active measurement feedback layer and clear it aggressively on lifecycle changes.

## Migration Plan

No document migration is expected. Rollback is limited to removing the runtime wiring, measurement resolver, and presentational overlays; no authored model data changes are introduced.

## Open Questions

- Whether the measurement panel should surface approximation badges for sampled spline or mixed-topology distance values if exact kernel values are unavailable at runtime.
- Whether face readouts should always include a boundary-length list or collapse that detail behind a compact summary when a face has many edges.
