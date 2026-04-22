## Why

Sketches currently read as part of the lit 3D scene, which makes sketch edges, vertices, constraints, and regions feel less like flat authoring graphics. Constraint health is also not visually distinguishable in the sketch geometry itself, so users cannot quickly tell whether a sketch is underconstrained, fully constrained, or overconstrained from the viewport.

## What Changes

- Render all active and committed sketch edges, vertices, constraints, and sketch-owned region fills with unlit flat materials so sketch graphics do not pick up reflective or shaded 3D surface treatment.
- Color sketch edges, constraints, and vertices by the owning sketch constraint state:
  - constrained sketches use `--workbench-tooltip-description`.
  - underconstrained sketches use `--mantine-color-blue-9`, the existing theme blue closest to `#1651b0`.
  - overconstrained or inconsistent affected sketch geometry uses `--workbench-shell-danger-text`.
- Make sketch-owned region fills a deeper gray than the current region fill while keeping regions subordinate to wire geometry.
- Preserve authored SVG fill and stroke behavior when enabled, except that overconstrained affected edges receive a thin diagnostic/error line over the canonical sketch edge; the diagnostic color must not replace the whole authored stroke width or fill.
- Avoid introducing new theme colors, a new aesthetic system, or unrelated viewport UI changes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `viewport-authoring-feedback`: update sketch viewport styling requirements for flat sketch rendering, constraint-state sketch colors, and deeper neutral sketch-region fills.

## Impact

- Affected code likely includes sketch session and committed sketch display renderable derivation, sketch display material helpers, Three.js material selection in the CAD viewport, constraint annotation styling, and style-focused tests.
- No API or dependency changes are expected.
- Verification should include focused unit coverage for material configuration and full project `bun run test`, `bun run lint`, and `bun run build` after implementation.
