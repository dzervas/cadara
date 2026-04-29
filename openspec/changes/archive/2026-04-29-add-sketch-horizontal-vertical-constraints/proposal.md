## Why

Sketch mode already supports horizontal and vertical distance dimensions and can infer horizontal constraints from snap intent, but it does not expose explicit Horizontal and Vertical constraint tools for existing lines. This makes a common sketching workflow unavailable and leaves the line-orientation contract ambiguous when sketches live on planes other than XY.

Assumption: the existing durable `horizontal` and `vertical` constraint kinds remain the source of truth, and this change adds explicit authoring behavior plus clearer sketch-plane-axis semantics rather than introducing new constraint data types.

## What Changes

- Add explicit sketch Horizontal and Vertical constraint tools that let the user select a line and constrain it to the sketch plane's horizontal or vertical axis.
- Define Horizontal and Vertical as line-orientation constraints, distinct from horizontal or vertical distance dimensions.
- Clarify that these constraints are evaluated in sketch-plane coordinates, so a sketch on XY constrains against X/Y, a sketch on YZ constrains against its local sketch axes, and so on.
- Render and expose committed horizontal and vertical constraints through the same durable annotation and deletion flows used by other sketch constraints.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sketch-constraint-authoring`: add explicit horizontal and vertical constraint authoring for existing lines, distinct from directional dimensions.
- `sketch-constraint-tool-behavior`: expose Horizontal and Vertical as sketch constraint tools with single-line selection and durable commit behavior.
- `sketch-constraint-solver`: clarify that horizontal and vertical constraints solve against sketch-plane axes rather than world-space axes.

## Impact

- Affected specs: `sketch-constraint-authoring`, `sketch-constraint-tool-behavior`, `sketch-constraint-solver`
- Likely affected code: sketch constraint registry, toolbar/tool metadata, sketch session authoring flow, solver tests and annotation/tool tests
- Assets/UI: horizontal and vertical constraint toolbar icons should reuse or align with existing public constraint glyph assets where possible
