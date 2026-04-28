## Why

Reference-image calibration currently depends on a dedicated calibration solver with a reduced toolset, which diverges from the normal sketch workflow and has already produced fragile failure modes around underconstrained and collapsing solves. We need calibration anchors to participate in the same sketch constraint and dimension system the rest of the editor uses, so image fitting becomes a derived result of the normal sketch solve rather than a second constraint system that users must learn and trust separately.

## What Changes

- Replace operation-local calibration constraints with sketch-owned anchor geometry that is authored into the normal flat sketch graph.
- Keep reference-image anchors locked to image-space `u/v` coordinates inside the reference-image operation state, but bind each anchor to a durable local sketch point id that can be constrained and dimensioned through existing sketch tools.
- Redefine reference-image calibration mode as an anchor-placement and anchor-management workflow only; it must not own horizontal, vertical, distance, or other geometric solving behavior.
- Derive reference-image placement from solved sketch anchor point positions plus stored image-space `u/v` bindings after each normal sketch solve.
- Preserve the current safety behavior for weak or contradictory fits by surfacing diagnostics and retaining the last stable image placement instead of collapsing or exporting invalid calibration output.
- Remove the dedicated reference-image distance-constraint authoring flow and the notion that calibrated image anchors export as a separate solver-owned projected-reference system.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `reference-image-calibration`: calibration must keep its dedicated mode but stop using a dedicated geometric constraint solver in favor of bound sketch anchors plus post-solve image fitting.
- `reference-image-anchor-reference-points`: fixed exported calibration anchor references must be removed because image anchors now live as ordinary bound sketch points in the flat graph.
- `reference-image-sketch-op`: reference-image operations must persist sketch-anchor bindings and derive image placement from solved sketch points instead of a dedicated calibration constraint set.
- `sketch-special-editor-modes`: reference-image calibration mode must be limited to placing, selecting, and maintaining anchor bindings while handing all geometric constraint solving back to normal sketch editing.
- `sketch-constraint-authoring`: reference-image anchor points must be ordinary sketch constraint/dimension targets after placement, with no separate calibration-only constraint workflow.
- `sketch-authoring-operations`: reference-image operations must support mixed ownership where the operation persists image payload and anchor binding metadata while the bound anchor points live in the ordinary flat sketch graph.

## Impact

- Affected code will include the reference-image operation contract, calibration mode state/presentation, sketch-session mutation flows, sketch commit/replay logic, bound-point lifecycle, projected-reference removal, and any calibration-specific solver/export code.
- The dedicated reference-image calibration solver will be reduced to a placement-fit and validation step, or removed entirely as a constraint solver boundary.
- Existing documents with operation-local calibration anchors and distance constraints will require a migration or compatibility strategy.
- UI and workflow impact is significant: calibration exits into standard sketch editing, and anchors become visible/manageable as normal sketch construction geometry rather than special exported references.
