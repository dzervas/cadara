## Context

Extrude currently stores a blind linear `endExtent` with direction and distance. Revolve stores an angular extent with direction and radians. Onshape exposes richer end conditions for both features: extrude supports blind, up to next, up to face, up to part, up to vertex, through all, symmetric, second end position, and draft; revolve supports full revolve and similar non-full end types.

The repo already has explicit profile collections and boolean scopes. This change should extend those typed contracts rather than moving core features into the advanced-solid option bag.

## Goals / Non-Goals

**Goals:**
- Add a typed extent model with `oneSide`, `symmetric`, and `twoSide` modes.
- Support extrude end conditions: blind, up to next, up to face, up to part, up to vertex, and through all.
- Support revolve end conditions: full, blind, up to next, up to face, up to part, and up to vertex.
- Support Onshape-like offset values for up-to end conditions.
- Add expression-capable draft and extent values.
- Implement OCC geometry and diagnostics for all supported contract states.

**Non-Goals:**
- Do not add surface or thin extrude/revolve variants.
- Do not add starting offset or custom extrude direction in this slice; Onshape-result parity is scoped to end-position, up-to offset, draft, symmetric, and second-end controls.
- Do not expose independent second-end values when symmetric mode is active.

## Decisions

1. Use explicit extent mode instead of booleans.

   Model extent as one active mode:

   - `oneSide`
   - `symmetric`
   - `twoSide`

   This prevents invalid combinations such as symmetric plus second end. Symmetric mirrors the first end and its draft angle automatically. Extrude symmetric mode is valid only for blind and through-all ends. Revolve symmetric mode is valid only for blind angular extents.

2. Keep `upToNext` targetless.

   The point of up-to-next is that the kernel determines the next terminating geometry in the feature direction. It should not require selected targets. Diagnostics must report when no terminating geometry is found or when the feature cannot fully terminate.

   Up-to-next still supports an authored offset value, matching the Onshape behavior where the feature can fall short of the next encountered entity.

3. Make through-all pierce all forward target geometry.

   Through-all should produce enough linear extrude extent to pass through all geometry in front of the profile along the extrude direction, following Onshape-like behavior. Boolean target scope defines the bodies considered for boolean operations; standalone behavior should remain valid when the result can be modeled.

4. Keep revolve angular termination explicit.

   Revolve keeps its axis and angular semantics. Up-to variants must compute angular termination around the axis rather than reusing linear extrusion math.

## Risks / Trade-offs

- Up-to-next can be ambiguous in complex multi-body models -> return deterministic diagnostics when a unique terminating condition cannot be found.
- Through-all for standalone new bodies can be less meaningful than for booleans -> allow the contract but require geometry tests and diagnostics for impossible cases.
- Up-to offsets add another failure mode when the offset crosses or bypasses the terminating entity -> validate the resolved offset and return geometry diagnostics for impossible results.
- Revolve up-to behavior is harder than blind/full revolve -> implement with focused geometry helpers and regression cases before UI polish.
