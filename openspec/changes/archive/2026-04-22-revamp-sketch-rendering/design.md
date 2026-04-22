## Context

Sketch display rendering currently uses Three.js material helpers that can give active and committed sketch graphics the same lit, dimensional feel as model geometry. Existing viewport authoring requirements also describe sketch-owned regions as faint cyan, while the requested direction is neutral, flatter, and driven by constraint health. The theme already exposes the required tokens through Mantine/CSS variables, including `--workbench-tooltip-description`, `--mantine-color-blue-9`, `--workbench-shell-danger-text`, and workbench dark gray tokens.

## Goals / Non-Goals

**Goals:**

- Make active and committed sketch edges, vertices, constraint annotations, and sketch-owned regions render with unlit flat materials.
- Map sketch constraint states to existing theme tokens only: constrained to `--workbench-tooltip-description`, underconstrained to `--mantine-color-blue-9`, and overconstrained or inconsistent affected geometry to `--workbench-shell-danger-text`.
- Make sketch regions a deeper neutral gray while keeping opacity low enough that wire geometry remains dominant.
- Keep authored SVG fill/stroke rendering behavior intact when SVG rendering is enabled.

**Non-Goals:**

- Add new theme colors or redesign the viewport palette.
- Change sketch solving semantics or constraint-state calculation.
- Change picking behavior, selection routing, or sketch-region derivation.
- Rework non-sketch solid, datum, or feature preview styling.
- Recolor an entire authored thick stroke or region fill merely because one edge is overconstrained.

## Decisions

1. Use existing theme CSS variables as the rendering palette source.

   The viewport should resolve sketch colors from existing Mantine/workbench CSS variables, not from new hardcoded palette constants. The constrained color is `--workbench-tooltip-description`; the underconstrained color is `--mantine-color-blue-9`, which is the existing Mantine blue closest to `#1651b0`; the overconstrained/error color is `--workbench-shell-danger-text`; and sketch-owned region fills should use an existing dark/workbench gray token such as `--workbench-shell-border` with low opacity. The implementation can convert CSS color values to `THREE.Color` near the React viewport boundary and pass numeric colors into material helpers. This keeps Three.js materials practical while preserving the theme as the source of truth.

   Alternative considered: add new sketch-specific constants in `SURFACE_COLORS`. That would be simpler locally, but it would violate the request to use only theme-defined colors and would make future theme edits harder.

2. Keep constraint-state styling as display metadata, not solver logic.

   Active sketch session display renderables and committed sketch renderables should carry or be resolved against the sketch's solved `constraintState` that already exists in the sketch contract. Rendering should classify `wellConstrained` as constrained, `underConstrained` or `unknown` as underconstrained, and `overConstrained`, `inconsistent`, or failed/partial solve states with unsatisfied affected geometry as overconstrained/error presentation.

   Alternative considered: infer status from individual constraint statuses in the viewport. That duplicates solver classification and would leak solver details into presentation code.

3. Use unlit Three.js materials for sketch display renderables.

   Active and committed sketch mesh and marker display renderables should use `MeshBasicMaterial`, and sketch wires should remain line-basic or dashed-line materials. This removes metalness, roughness, emissive, and light-dependent reflection from sketch graphics while keeping document solids on their existing shaded path.

   Alternative considered: tune `MeshStandardMaterial` to be less reflective. That still leaves sketch appearance light-dependent and makes “flat” harder to guarantee.

4. Preserve authored SVG styles as explicit overrides except for thin overconstraint diagnostics.

   When authored SVG rendering is enabled and a renderable has supported authored style data, that style should still apply. The new constraint-state palette is the default sketch styling path, not a replacement for intentional user-authored fill or stroke choices. The only override is overconstrained affected geometry: render a thin, predefined diagnostic/error line along the affected canonical sketch edge or annotation while leaving the authored stroke width, fill, and unaffected edges unchanged. For example, if a user-authored edge has a 10px stroke, only the thin diagnostic line on the affected edge becomes red.

   Alternative considered: always override authored styles with constraint-state colors. That would make constraint health very visible but would break the existing SVG sketch style contract and would hide intentional thick strokes/fills.

## Risks / Trade-offs

- Theme CSS variables may not parse directly in non-DOM tests -> keep the pure material configuration logic testable with injected resolved color values or exported token names, and test DOM resolution separately only where needed.
- Authored SVG styles can reduce visibility of constrained or underconstrained default colors -> preserve authored styles for normal states, and use only the thin affected-edge diagnostic overlay for overconstrained geometry.
- Constraint annotations and geometry can drift if they resolve status through different paths -> centralize the constraint-state-to-token mapping and reuse it for wires, markers, and annotation presentation.
- Deeper gray regions may be less discoverable than cyan regions -> keep hover and selection highlighting unchanged so interaction feedback remains visible.
