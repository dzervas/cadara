## Context

The current viewport builds Three.js objects from renderables and raycasts directly against those objects for hover and selection. The semantic part of the system is already project-owned and should stay that way: durable target bindings, selection filtering, hover priority, and sketch-plane projection are not the problem. The expensive part is the geometric intersection search itself.

This makes BVH a good fit because it can accelerate the same picking semantics without requiring a redesign of the viewport contract. The change should stay independent of the broader React Three Fiber migration so the acceleration work can land on the current runtime and remain reusable later.

## Goals / Non-Goals

**Goals:**
- Accelerate viewport hover and selection raycasts with BVH-backed intersection tests.
- Preserve current durable target bindings and selection semantics.
- Keep the implementation compatible with the current imperative viewport and reusable by a future R3F runtime.
- Rebuild or invalidate BVH state correctly when renderable geometry changes.

**Non-Goals:**
- Changing hover or selection business logic.
- Replacing the current viewport runtime with R3F in this change.
- Redesigning materials, controls, camera framing, or sketch-plane projection.
- Optimizing every object type if the gain is concentrated in mesh-heavy document geometry first.

## Decisions

### Use BVH for geometric acceleration, not semantic picking

The integration should accelerate only the intersection phase. The project should continue to own how an intersection is translated into a durable target, how selection filters are applied, and how hover priority is resolved.

This is preferable to introducing a library-owned picking model because the viewport already depends on CAD-aware target semantics.

### Keep the BVH integration runtime-agnostic

The first implementation should target the current Three.js runtime through a library such as `three-mesh-bvh`, rather than depending on a React Three Fiber-only abstraction. If the viewport later migrates to R3F, the same acceleration strategy can be reused or wrapped by drei-compatible primitives.

This is preferable to tying BVH to the R3F migration because scene-scale picking is a separate concern and can deliver value independently.

### Build BVH only for geometry classes that benefit materially

The initial scope should focus on mesh-backed document geometry and any other renderable classes where BVH materially reduces intersection work. Lightweight helper objects, sketch markers, or tiny proxy meshes can remain on the existing path if that keeps the integration simpler.

This is preferable to forcing every renderable through one acceleration path, which would add complexity without proportional payoff.

### Rebuild BVH on scene rebuild boundaries

BVH state should be created or refreshed when the viewport rebuilds its render scene from renderable records. This keeps synchronization straightforward and avoids hidden stale-geometry bugs.

This is preferable to incremental per-object mutation tracking in the first version because the viewport already has clear rebuild boundaries.

### Verify parity before treating acceleration as complete

The change is successful only if hover and selection outcomes remain the same while the acceleration layer is active. Tests should treat picking parity as the primary correctness check, with denser-scene coverage added to guard against regressions in the accelerated path.

This is preferable to focusing only on micro-benchmarks because the product risk is incorrect picking, not merely slower picking.

## Risks / Trade-offs

- [BVH integration can diverge from current hit-testing behavior] → Mitigate by keeping semantic target resolution unchanged and adding parity-focused hover/selection tests.
- [Rebuilding BVH may add upfront scene-build cost] → Mitigate by rebuilding at existing scene-refresh boundaries and targeting the geometry classes that benefit most.
- [Some renderable types may not fit the accelerated path cleanly] → Mitigate by keeping a mixed strategy where non-beneficial helper geometry remains on the existing picking path.
- [Future R3F migration could otherwise duplicate the acceleration work] → Mitigate by keeping the BVH integration runtime-agnostic and centered on renderable geometry rather than UI framework abstractions.

## Migration Plan

1. Add the BVH dependency and integrate accelerated raycasting into the current viewport picking path.
2. Build BVH state when document renderables are converted into Three.js geometry and keep non-beneficial helper geometry on the existing path as needed.
3. Validate hover and selection parity on current viewport behavior.
4. Add denser-scene picking coverage and remove any now-redundant unaccelerated mesh raycast glue.

## Open Questions

- Whether the initial implementation should accelerate only mesh-backed document geometry or also polyline-heavy paths through proxy geometry.
- Whether the repo wants explicit performance instrumentation in tests now or only correctness and stability coverage in this change.
