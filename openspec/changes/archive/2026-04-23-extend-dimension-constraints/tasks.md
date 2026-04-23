## 1. Dimension Contracts

- [x] 1.1 Extend `DimensionDefinition` and related schemas with diameter, line-to-line distance, line-to-point distance, line-to-line angle, and optional annotation placement metadata.
- [x] 1.2 Add type guards/helpers for resolving local circle/arc, line, point, and supported projected sketch-space operands without duplicating target-resolution logic.
- [x] 1.3 Update dependency cleanup and authoring-operation graph handling so deleted geometry removes any new dimension records that reference it.

## 2. Dimension Authoring

- [x] 2.1 Extend the Dimension tool target workflow to infer diameter, line distance, point-line distance, or angle dimension intent from selected target kinds.
- [x] 2.2 Add validation feedback for unsupported, missing, non-parallel distance, parallel angle, and degenerate target combinations.
- [x] 2.3 Track pending annotation placement in active constraint-authoring state separately from pending numeric value.
- [x] 2.4 Commit durable dimensions with the selected operands, authored value, and accepted annotation placement metadata.

## 3. Solver Support

- [x] 3.1 Add solver residual/status evaluation for circle and arc diameter dimensions.
- [x] 3.2 Add solver residual/status evaluation for line-to-line perpendicular distance dimensions between parallel line references.
- [x] 3.3 Add solver residual/status evaluation for line-to-point perpendicular distance dimensions.
- [x] 3.4 Add solver residual/status evaluation for non-parallel line angle dimensions.
- [x] 3.5 Report invalid expanded dimensions as unsatisfied or invalid without creating fallback geometry or reinterpreting dimension kinds.

## 4. Viewport Feedback

- [x] 4.1 Extend `dimensionLine` and `angleArc` overlay descriptors/projection with stable draggable geometry handles.
- [x] 4.2 Route preview dimension-line drags into sketch-plane placement updates for linear and diameter dimensions.
- [x] 4.3 Route preview angle-arc drags into sketch-plane radius/side placement updates for angle dimensions.
- [x] 4.4 Render committed distance, diameter, and angle annotations from solved geometry plus stored placement metadata, with deterministic fallback placement for existing dimensions.
- [x] 4.5 Preserve existing viewport picking, drawing, pan, and rotate behavior for pointer interactions that do not start on draggable preview geometry.

## 5. Tests and Verification

- [x] 5.1 Add `bun:test` coverage for dimension target resolution, invalid target rejection, and durable commit payloads.
- [x] 5.2 Add solver tests for diameter, line-line distance, line-point distance, angle dimensions, and invalid expanded dimension diagnostics.
- [x] 5.3 Add viewport feedback tests for draggable dimension-line and angle-arc descriptor projection/rendering.
- [x] 5.4 Run `bun run test`, `bun run lint`, and `bun run build`.
