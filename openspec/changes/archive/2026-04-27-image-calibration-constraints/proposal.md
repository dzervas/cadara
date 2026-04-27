## Why

Image reference sketches exist but cannot be calibrated. The current implementation creates the image quad with zero constraints — all 8 DOF are free and there is no mechanism to connect user-drawn calibration geometry to the image. If a user draws a line over a ruler in the image and dimensions it to 10mm, the dimension only constrains the line's endpoints — two floating sketch points unrelated to the image corners. The image doesn't move because nothing links calibration geometry to image space.

Two things are missing:
1. A constraint that pins a sketch point to a specific normalized position on the image quad, so that when corners move (scale/rotate/translate), the pinned point moves with them.
2. An initial constraint setup that anchors position and orientation while leaving scale as a free DOF so the solver can adjust it when calibration constraints are added.

## What Changes

- **New `pointOnImage` sketch constraint** — constrains a sketch point to lie at normalized coordinates `(u, v)` on the image quad (0,0 = top-left, 1,1 = bottom-right). The solver evaluates this by computing the expected position from the current corner positions via bilinear interpolation and penalizing deviation. This is the link between user-drawn geometry and the image transform — when the user dimensions a line between two image-pinned points, the solver adjusts corners to satisfy the distance.
- **Initial image constraint setup** — the image import provider adds structural constraints to the currently unconstrained quad:
  - 1 fixPoint on the top-left corner (2 DOF: anchors position)
  - 1 horizontal constraint on the TL→TR edge (1 DOF: initial rotation)
  - Rectangular quad constraints between corners: parallel opposite edges, perpendicular adjacent edges, equal-length opposite edges (prevents warp, preserves aspect ratio, ~3 DOF)
  - No scale constraint — scale is free (1 DOF remaining), ready for calibration
  - Total: ~7 DOF consumed, 1 free (scale). The image has a stable position and orientation but its size is adjustable.
- **Image pin placement in the sketch editor** — when editing an image reference sketch, clicking on the image creates a sketch point with a `pointOnImage` constraint at the clicked position's normalized (u, v) coordinates. The point appears pinned to the image and moves with it when corners are adjusted by the solver.
- **Calibration workflow** — user edits the image sketch, places two pin points on a known-dimension feature (e.g., ruler marks), draws a line between them, adds a dimension constraint (e.g., 10mm). The solver adjusts the image scale so that the distance between the two (u, v) positions matches 10mm. For orientation: user places two pin points on a feature that should be vertical, draws a line, adds a vertical constraint. The solver adjusts the image rotation.

## Capabilities

### New Capabilities
- `image-calibration-constraint`: Defines the `pointOnImage` constraint kind, its solver evaluation via bilinear interpolation on the image quad, the `(u, v)` normalized coordinate model, and integration with the sketch constraint graph.
- `image-pin-placement`: Defines the sketch editor behavior for placing image-pinned points — click-on-image detection, (u, v) coordinate computation from click position, automatic creation of sketch point + `pointOnImage` constraint pair.

### Modified Capabilities
- `sketch-constraint-authoring`: The constraint definition union gains the `pointOnImage` variant.
- `image-import-provider`: The initial constraint setup is added (currently has zero constraints) — anchored rectangular setup with free scale.
- `image-reference-sketch-entity`: Corner points gain rectangular quad constraints (currently unconstrained).

## Impact

- `src/contracts/sketch/schema.ts`: `ConstraintDefinition` union extended with `pointOnImage` kind.
- `src/contracts/sketch/runtime-schema.ts`: Zod schema for the new constraint.
- `src/contracts/sketch/solver-core.ts`: Solver evaluation for `pointOnImage` — bilinear interpolation from 4 corner positions, gradient computation for all 4 corners + the pinned point.
- `src/domain/import/providers/image-import-provider.ts`: Updated `createImageReferenceSketchDefinition()` — add anchor fixPoint + horizontal + rectangular constraints (currently has zero constraints).
- `src/domain/editor/sketch-session.ts`: Pin point placement on image click — hit-test image quad, compute (u, v), create point + constraint.
- Sketch viewport: visual indicator for image-pinned points (pin icon or distinctive marker).
