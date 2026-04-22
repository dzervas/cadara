## 1. Theme Color Resolution

- [x] 1.1 Add a small sketch rendering palette resolver that maps constrained, underconstrained, overconstrained, and region-fill roles to exact existing theme CSS variables.
- [x] 1.2 Add focused tests proving the resolver references only existing theme tokens and classifies solved sketch states and failed/partial fallback states correctly.

## 2. Sketch Renderable State

- [x] 2.1 Thread active and committed sketch solved status or normalized constraint display state into sketch display material configuration without changing solver behavior.
- [x] 2.2 Keep authored SVG fill and stroke style metadata as explicit overrides when SVG rendering is enabled for non-overconstrained states.
- [x] 2.3 Derive affected overconstrained sketch geometry targets for thin diagnostic/error rendering without recoloring unaffected geometry.

## 3. Flat Sketch Materials

- [x] 3.1 Update active and committed sketch mesh and marker rendering to use unlit flat material treatment while preserving existing picking bindings and render order.
- [x] 3.2 Update default sketch wire, vertex, and constraint annotation colors to use the exact theme-backed constraint-state palette.
- [x] 3.3 Render overconstrained affected edges with a thin predefined error line that can override selected/authored color only for that affected canonical edge.
- [x] 3.4 Change default sketch-owned region fills from cyan to a deeper theme-backed neutral gray while keeping low opacity and hover/selection behavior intact.

## 4. Verification

- [x] 4.1 Add or update focused `bun:test` coverage for sketch display material configuration, constraint-state color selection, authored-style preservation, and thin affected-edge overconstraint diagnostics.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
- [x] 4.4 Run `bun run build`.
