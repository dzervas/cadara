# Minimum-Motion Sketch Drag

## Why

Interactive sketch dragging is unpredictable today. The same gesture can produce a rigid translation, a stretch, a reflected ("flipped") component, or an outright refusal, depending on which of three competing solver mechanisms happens to succeed first:

1. Every acceptance path requires the dragged point to reach the cursor exactly (`targetDistance <= targetTolerance`), so partially constrained points that can only slide are reported as `blocked` instead of sliding to the closest feasible position.
2. Branch exploration deliberately seeds mirrored copies of the dragged component (`orientation: -1` isometry branches) and accepts whichever converges, producing sketch-destroying flips.
3. A rigid-translation fast path moves the entire connected component when it happens to validate, and silently falls back to single-point pulling when it does not — the same gesture yields two different behaviors based on an invisible condition.
4. The numeric solve has a null space in under-constrained sketches and nothing prefers solutions where distant geometry stays put, so unrelated geometry drifts during drags.

This change replaces those mechanisms with one deterministic model users can build a habit around: **drag = continuous minimization of distance-to-cursor, subject to hard constraints, warm-started from the previous frame, with minimum motion of everything else.**

Assumptions (stated explicitly per project rules):

- Diverging from Onshape is acceptable as long as behavior is consistent and habit-formable; this proposal implements uniform minimum-motion ("policy 1") rather than constraint-graph-distance-weighted motion ("policy 2"). Policy 2 is documented as a rejected-for-now alternative in `design.md` and in code comments at the relevant solver seams.
- The existing custom solver in `src/contracts/sketch/solver-core.ts` is retained; swapping the numeric core (e.g. planegcs) is out of scope. The drag-semantics contract introduced here is solver-agnostic and would survive such a swap.
- Deliberate "flip through a singularity" (dragging a point across a zero-length configuration) remains possible as an emergent result of continuous solving; only *searched* discontinuous branches are removed.

## What Changes

- **BREAKING (solver contract)**: Interactive dragged-point solves treat the cursor as a soft objective and authored constraints/dimensions as hard. A frame is accepted whenever hard constraints are satisfied, regardless of how close the dragged point got to the cursor. `blocked` is reserved for non-convergent or invalid solves; a satisfiable sketch is never refused.
- Add uniform minimum-motion regularization (policy 1): a weak quadratic prior keeping every non-dragged point at its previous-frame position, so under-constrained null spaces resolve to the least-surprising solution and distant geometry does not drift. Code comments at the regularization seam document policy 2 (distance-weighted motion) as the considered alternative.
- **BREAKING (solver behavior)**: Remove reflected/mirrored branch exploration (`orientation: -1` isometry seeds) from interactive drag solves. Drag frames must be continuous with the previous frame.
- Subdivide large per-frame cursor deltas into substeps so the solve tracks the constraint manifold continuously instead of teleporting past singularities.
- **BREAKING (editor semantics)**: Point drags target only the grabbed point; rigid component translation is no longer a point-drag outcome. Rigid translation becomes the explicit semantics of entity-body drags (grabbing a line body, circle body, etc.). The existing rigid-translation fast path may remain only as an optimization that provably matches the general minimum-motion solve result (e.g. internally rigid components).
- Define a deterministic per-handle drag semantics table (point, entity body, circle rim/center) as a new capability so users can predict what any grab does.
- Blocked-movement feedback is reframed: fully constrained geometry no-ops with constrained-movement feedback; partially constrained geometry slides along its remaining degrees of freedom.

## Capabilities

### New Capabilities

- `sketch-drag-semantics`: Deterministic per-handle drag intent contract (what grabbing a point, entity body, or circle rim/center means), minimum-motion solution selection, and drag-frame continuity guarantees.

### Modified Capabilities

- `sketch-constraint-solver`: Interactive dragged-handle solves change from all-or-nothing target satisfaction to soft-target/hard-constraint acceptance; add minimum-motion regularization and remove discontinuous branch exploration.
- `sketch-geometry-editing`: Constrained drags slide along remaining degrees of freedom instead of blocking; blocked feedback is reserved for fully constrained targets and non-convergent solves; point drags no longer rigidly translate whole components.

## Impact

- Affected code:
  - `src/contracts/sketch/solver-core.ts` — drag acceptance (`createDraggedPointAcceptance`, `createDraggedBranchAcceptance`), branch exploration (`createDraggedComponentBranchSeeds`, `tryExploreDraggedComponentBranches`, `createTwoPointIsometryBranchValues` — removed for drags), translation fast paths (`tryTranslateDraggedComponent`, `trySolveDraggedPointAsComponentTranslation` — regated), drag objective (`createDragTargetConstraint` — gains minimum-motion terms), session update (`updateCompiledSketchSolveSession` — substepping)
  - `src/domain/solver/*` adapters and `src/contracts/solver/*` where drag result kinds surface
  - Sketch drag lifecycle seams in `src/domain/editor/sketch-session/` and viewport drag intent mapping in `src/workbench/viewport/`
- Affected specs:
  - new `sketch-drag-semantics`
  - deltas for `sketch-constraint-solver`
  - deltas for `sketch-geometry-editing`
- Existing scenario "dragging one vertex of a fully shaped square with free position moves the whole square" is preserved: with a rigid shape, translation *is* the minimum-motion solution — it now emerges from the model instead of a special-cased fast path.
- Regression fixtures should be captured from currently-misbehaving sketches (flip, refusal, drift) before behavior changes, using the existing instrumented solver adapter / bug-reporting seams.
- `bun run test:all` (via `podman-compose exec agent`) must pass; solver benchmarks must not regress materially on the existing 10/50/150-constraint fixtures.
