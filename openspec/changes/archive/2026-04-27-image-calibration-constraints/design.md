## Context

The image reference entity has 4 corner sketch points (TL, TR, BR, BL) that define a textured quad on the sketch plane. The solver treats these as regular points via `getEntityPoints()`. The current image import creates the quad with zero constraints — all 8 DOF are free. Without any structural constraints, the quad can drift, rotate, skew, and scale arbitrarily when other constraints are added to the sketch.

The sketch solver is a least-squares system — constraints contribute quadratic penalty terms and the solver minimizes total residual. Adding a new constraint kind requires implementing an `evaluate()` function that returns a residual and gradient. The existing constraint infrastructure handles the rest (iteration, convergence, diagnostics).

The key insight: calibration only works if user-drawn geometry is linked to image space. A line drawn "over" a ruler in the image is just two floating sketch points — they have no relationship to the image corners. The `pointOnImage` constraint creates this relationship by saying "point P is at fractional position (u, v) on the image quad."

## Goals / Non-Goals

**Goals:**
- A `pointOnImage` constraint that pins a sketch point to normalized (u, v) coordinates on an image quad, with proper solver evaluation and gradient.
- A revised initial constraint setup that leaves scale as a free DOF, ready for dimension-based calibration.
- A sketch editor interaction for placing image-pinned points by clicking on the image.
- End-to-end calibration: import image → edit sketch → place pins on ruler marks → draw line → dimension it → image scales correctly.

**Non-Goals:**
- Perspective correction / warp — the initial setup preserves rectangular shape. Warp is a future extension where the user relaxes rectangular constraints.
- Automatic feature detection or ruler recognition in images.
- A dedicated "calibration mode" or wizard — calibration uses standard sketch editing with the pin-point interaction as the only new UI element.
- Calibration for non-image entities — `pointOnImage` is specific to image reference quads.

## Decisions

### 1. Bilinear interpolation for (u, v) → position mapping

**Decision:** `pointOnImage` evaluates by computing the expected position of (u, v) on the image quad via bilinear interpolation of the 4 corner positions:

```
P_expected = TL*(1-u)*(1-v) + TR*u*(1-v) + BR*u*v + BL*(1-u)*v
```

The residual is `||P_actual - P_expected||²` and the gradient propagates to all 4 corner positions and the pinned point's position (5 points × 2 coordinates = 10 partial derivatives).

**Alternative considered:** Linear interpolation from 2 points (anchor + scale point). This would require a different image model with only 2 defining points instead of 4 corners. It's simpler but doesn't support warp/perspective correction in the future.

**Rationale:** Bilinear interpolation naturally works for both rigid transforms (rectangular quad) and warped quads (non-rectangular). When the quad is rectangular, it reduces to the affine case. The gradient is straightforward to compute analytically.

### 2. Rectangular quad constraints for initial setup

**Decision:** Add structural constraints to the currently unconstrained quad:
- 1 `fixPoint` on TL (anchors position, 2 DOF)
- 1 `horizontal` constraint on the TL→TR line segment entity (anchors rotation, 1 DOF)
- 4 structural constraints that keep the quad rectangular:
  - `parallel` between TL→TR edge and BL→BR edge
  - `parallel` between TL→BL edge and TR→BR edge
  - `perpendicular` between TL→TR edge and TL→BL edge
  - `equalLength` between TL→TR and BL→BR edges, and between TL→BL and TR→BR edges

This gives: 2 (fixPoint) + 1 (horizontal) + ~4 (rectangular) = 7 DOF consumed. With 8 DOF total, 1 DOF remains free — the uniform scale factor.

**Alternative considered:** Fixing 2 corners instead of 1 corner + horizontal. This consumes 4 DOF for position, leaving 4 DOF for scale, rotation, and warp. But it over-anchors position (you only need 2 DOF for position) and under-constrains orientation.

**Rationale:** The setup directly matches the calibration workflow: position and orientation are initially locked, scale is free. The user's first calibration action (dimensioning a line between two pinned points) consumes the remaining DOF and fully constrains the image. Adding an orientation calibration after that makes the system overconstrained on the horizontal constraint — but the user can delete the initial horizontal constraint to free rotation.

### 3. Structural edge entities between corners

**Decision:** The image import creates 4 line segment entities connecting adjacent corners (TL→TR, TR→BR, BR→BL, BL→TL) as construction geometry. These edge entities are the targets for the parallel, perpendicular, horizontal, and equalLength constraints.

**Rationale:** The existing constraint kinds (parallel, perpendicular, horizontal, equalLength) operate on line segment entity IDs, not on point pairs. We need the edge segments as constraint operands. Making them construction geometry means they don't contribute to profile regions but are visible in the sketch (the user can see the image boundary).

### 4. Click-on-image places a pin point

**Decision:** When the sketch editor is active and contains an image reference entity, clicking on the image quad creates:
- A new sketch point at the clicked world-space position (projected to sketch plane)
- A new `pointOnImage` constraint with (u, v) computed from the click position relative to the current corner positions

The (u, v) is computed by inverting the bilinear mapping: given the click position and the 4 corner positions, find the (u, v) that maps to that position. For a rectangular quad this is a simple normalization.

**Alternative considered:** A separate "Pin" tool in the sketch toolbar. This would require tool definition, icon, activation state. It's heavier than necessary — the placement should be as lightweight as clicking on the image.

**Rationale:** Minimal UI friction. The user clicks where they want a reference point, the system creates it. The point behaves like any other sketch point afterward — the user can draw lines to it, constrain it, etc.

### 5. The constraint references the imageReference entity, not corner IDs directly

**Decision:** `pointOnImage` stores a reference to the `imageReference` entity ID (from which corners can be looked up) and the (u, v) coordinates. It does NOT store the 4 corner point IDs directly.

```
{
  kind: 'pointOnImage'
  pointId: SketchPointId
  imageEntityId: SketchEntityId
  u: number  // 0 = left, 1 = right
  v: number  // 0 = top, 1 = bottom
}
```

**Rationale:** The constraint is semantically "this point is at this position on this image." The solver resolves the image entity's corner point IDs when evaluating. If the entity's corner structure ever changes, only the solver evaluation changes, not persisted constraint records.

## Risks / Trade-offs

**[Bilinear inversion for (u, v) computation]** → For non-rectangular quads, inverting bilinear interpolation requires solving a quadratic. For rectangular quads it's a simple normalization. Mitigation: first version only needs rectangular quads (the initial setup keeps the quad rectangular). Non-rectangular inversion can be added when warp is supported.

**[Solver convergence with interconnected constraints]** → `pointOnImage` couples 5 points (4 corners + 1 pinned point). Multiple pinned points all share the same 4 corners. The Jacobian becomes dense in the corner DOFs. Mitigation: the least-squares solver already handles coupled constraints (e.g., multiple coincident constraints on the same point). The image corners are just heavily constrained points — the solver handles this naturally.

**[Overconstrained when adding orientation calibration]** → The initial setup includes a horizontal constraint on TL→TR. If the user adds a vertical constraint for orientation calibration, the system becomes overconstrained. Mitigation: the solver reports overconstrained diagnostics. The user deletes the initial horizontal constraint to free the rotation DOF. This is one delete operation — reasonable for calibration. The UI could additionally show a hint: "Remove the initial orientation constraint to calibrate rotation."

**[Edge entities add visual clutter]** → 4 construction line segments forming the image boundary are visible in the sketch. Mitigation: they're useful for understanding the image bounds and serve as constraint operands. Construction geometry already renders in a distinct style (dashed/lighter).
