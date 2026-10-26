# Onshape sketch interaction baseline

**Scope.** Bounded desk research for the sketch-readiness map, retrieved 2026-09-19. This records only behavior that Onshape's first-party Help states, not a proposed CADara contract. The sources are public browser-help pages; each link can be opened without an Onshape session.

## Documented baseline

### Selection and axes

- Selection is toggle-based: click selects and clicking the same entity again deselects; further clicks add to the selection set. Empty-space click, Space, or **Clear selections** clears it. [Selection][selection]
- Onshape documents one overlap priority rule: when selecting, a non-fully-constrained sketch point (blue or red) is prioritized over an overlapping fully-constrained point (black). The same rule is repeated on the Sketch Tools page. [Working with Constraints][constraints] [Sketch Tools][sketch-tools]
- The sources examined do **not** document an axis/origin/reference-geometry hit-test priority, cycling behavior, or whether axes yield to authored geometry. The documented point rule must not be generalized to axes.

### Construction geometry

- Construction geometry is a sketch entity used to create other geometry but is not used to create features. [Construction][construction]
- Users may either draw entities then toggle their construction state, or enable Construction before drawing; `q` toggles the state. [Construction][construction]

### Continuous tools and cancellation

- The Line tool creates a segment or a *series* of segments: successive clicks continue attached segments. [Line][line]
- While drawing a line, `Shift+A` (or hovering near the endpoint) switches to Tangent arc; after creating that arc, Onshape automatically returns to Line and can continue from the arc endpoint. [Line][line]
- Escape exits a selected sketch tool. [Sketch Tools][sketch-tools] The Sketch Mirror flow specifically says to press Escape to exit after selecting entities. [Sketch Mirror][sketch-mirror]

### Underconstrained state, dragging, and presentation

- Blue geometry is underconstrained, black is fully constrained, and red denotes a constraint problem/overconstraint. Constraint icons are black-on-gray when well-defined and white-on-red when problematic. [Working with Constraints][constraints]
- With a sketch open, hovering an entity shows its constraints; holding Shift while moving keeps all constraints visible. Hovered entities use orange, and related entities use yellow. [Working with Constraints][constraints]
- Onshape says dragging entities can help a user understand which dimensions or constraints to add. [Working with Constraints][constraints] Its mobile Sketch Tools help also says that, with no tool active, touch-dragging points or sketch entities adjusts them. [Sketch Tools][sketch-tools]
- **Not established:** documentation does not characterize desktop drag feel (latency, cursor anchoring, continuity, conflict resolution, or behavior for splines), nor does it name the sketch-solver algorithm. These require a live, human comparison; solver internals should not be inferred from UI help.

### Dimensions and circles

- The center-point-circle workflow sets a radius geometrically, but immediately after creation its optional numeric input is for the **diameter** and creates that dimension without the Dimension tool. The three-point-circle page likewise specifies an immediate diameter input. [Center Point Circle][center-circle] [3 Point Circle][three-circle]
- The Dimension tool supports both diametrical and radial dimensions. Its documented circle workflow creates a diameter dimension; its documented arc workflow creates a radius dimension. [Dimension][dimension]
- Dimensions are driving by default (and can be changed to driven). [Dimension][dimension]

### Sketch mirror

- Sketch Mirror reflects selected sketch entities about a specified line. It supports preselecting entities then choosing the tool, or choosing the tool first. [Sketch Mirror][sketch-mirror]
- The mirror reference may be a sketch line, plane, part face, or edge. In tool-first flow, selecting the reference prompts for entities; each selected entity is mirrored, and Escape exits the tool. [Sketch Mirror][sketch-mirror]

## Interpretation boundaries

These are implementation-relevant observations, not decisions:

1. The explicit overlap rule is narrow (underconstrained versus fully constrained **points**). It is evidence for a deliberate priority policy, not evidence for an axis policy.
2. The Help describes observable outcomes, not solver mechanics. Do not label a CADara solver as Onshape-like without an approved hands-on trial.
3. The sources support chained line creation and a clear Escape exit, but do not establish every tool's repeat/chaining/cancel behavior.
4. The diameter wording supports evaluating a diameter-first immediate circle dimension; it does not by itself prescribe CADara defaults.

## Recommended live comparison questions

A human evaluator should test an underconstrained spline and line near axes, overlapping authored/reference geometry, click/drag selection thresholds, repeated Escape, and whether line chaining resumes after tangent arcs. Record browser/device, zoom, and exact steps. This is necessary to evaluate feel and the undocumented axis policy, rather than treating this desk research as a behavioral specification.

## Sources

- [Selection](https://cad.onshape.com/help/Content/Home/selection.htm) — Onshape Help, “Selection,” retrieved 2026-09-19.
- [Working with Constraints](https://cad.onshape.com/help/Content/Sketch/working_with_constraints.htm) — Onshape Help, retrieved 2026-09-19.
- [Sketch Tools](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm) — Onshape Help, retrieved 2026-09-19.
- [Construction](https://cad.onshape.com/help/Content/Sketch/construction.htm) — Onshape Help, retrieved 2026-09-19.
- [Line](https://cad.onshape.com/help/Content/Sketch/line.htm) — Onshape Help, retrieved 2026-09-19.
- [Center Point Circle](https://cad.onshape.com/help/Content/Sketch/center_point_circle.htm) — Onshape Help, retrieved 2026-09-19.
- [3 Point Circle](https://cad.onshape.com/help/Content/Sketch/3_point_circle.htm) — Onshape Help, retrieved 2026-09-19.
- [Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm) — Onshape Help, retrieved 2026-09-19.
- [Sketch Mirror](https://cad.onshape.com/help/Content/Sketch/sketch_mirror.htm) — Onshape Help, retrieved 2026-09-19.
