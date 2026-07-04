# Design: Minimum-Motion Sketch Drag

## Context

The interactive drag pipeline in `src/contracts/sketch/solver-core.ts` currently layers four mechanisms per drag frame:

1. `tryTranslateDraggedComponent` / `trySolveDraggedPointAsComponentTranslation` — rigid translation of the entire connected component, guarded by a hand-maintained blacklist of projected-constraint kinds.
2. A numeric solve with a drag-target residual added to the constraint list, accepted only if the dragged point lands within tolerance of the cursor.
3. `tryPolishDraggedComponent` — gradient-descent polish under the same all-or-nothing acceptance.
4. `tryExploreDraggedComponentBranches` — up to 8 isometry seeds per anchor, including `orientation: -1` reflections of the whole component, accepted if any converges.

Each mechanism produces a different *kind* of result (translate / stretch / mirror / block), and which one wins is invisible to the user. Additionally, the under-constrained numeric solve has a null space with no preference for keeping non-dragged geometry still, so distant geometry drifts.

## Goals / Non-Goals

**Goals:**

- One user-statable drag model: "nothing moves unless a constraint forces it, and forced motion is minimal."
- No refusals for satisfiable sketches: partially constrained geometry slides; only non-convergence keeps the last good frame.
- No searched flips: drag frames are continuous with the previous frame.
- Deterministic per-handle intent: what you grab decides what is dragged, not solver luck.
- Property-testable guarantees (continuity bound, constraint satisfaction, minimality).

**Non-Goals:**

- Replacing the custom numeric solver core.
- Changing constraint/dimension authoring, inference, or region extraction.
- Implementing distance-weighted motion (policy 2) — documented as an alternative only.
- Matching Onshape behavior exactly; consistency wins over parity.

## Decisions

### D1: Soft cursor objective, hard constraints

The drag target becomes a soft objective term, never part of frame acceptance. Acceptance requires only: valid program, hard constraint/dimension residuals within tolerance, convergence. `targetDistance` is dropped from every acceptance predicate. Result kinds shrink accordingly: a feasible-but-lagging frame is `solved` (the point simply did not reach the cursor); `blocked` means non-convergent/invalid/stale only.

*Rejected alternative:* keeping `unsatisfied`-style blocking for out-of-reach cursors — this is the root cause of "refuses to move although underconstrained."

### D2: Uniform minimum-motion regularization (policy 1)

The interactive objective per frame is:

```
minimize  w_drag · ‖p_dragged − cursor‖²  +  ε · Σ_i ‖p_i − p_i_prevFrame‖²
subject to hard constraints (residuals within tolerance)
```

with `ε ≪ w_drag` and uniform across all non-dragged points. This makes every null-space direction cost something, so under-constrained solutions resolve to "move as little as possible", and geometry not forced by a constraint chain stays bit-exact (it already sits at its own term's minimum and warm-start keeps it there).

*Considered alternative (policy 2, distance-weighted motion):* weight `ε_i` by constraint-graph distance from the dragged point so nearby geometry is cheaper to move — feels more "physical" (things swing rather than stretch) but introduces a tunable and mild unpredictability. Deliberately not implemented; the seams where it would plug in are marked with code comments so the decision is discoverable next to the math.

Verifiable property: for every non-dragged point that moved in an accepted frame, dropping its ε-term must make some hard constraint unsatisfiable at its previous position — i.e. motion is forced, never incidental.

### D3: Stateful warm-start + substepping

One compiled solve session per drag gesture (already required by `sketch-solver-incremental-runtime`); values carry frame to frame, and the ε-term anchors update to the previous *accepted* frame. When the cursor moved more than a step limit since the last accepted frame, the target path is subdivided and solved in substeps so the solution tracks the constraint manifold continuously instead of jumping across singularities. Non-convergent substeps keep the last accepted frame (geometry lags the cursor) rather than escalating to a discontinuous search.

### D4: Remove branch exploration from drags

`tryExploreDraggedComponentBranches` and its reflected (`orientation: -1`) isometry seeds are removed from the interactive drag path. With D2 + D3, continuity makes searched flips unnecessary; deliberate flips through singular configurations still emerge naturally when the user drags across them.

### D5: Handle decides intent; translation is entity-drag semantics

- Point drag → soft target on that point only. Endpoint drags stretch/rotate their line.
- Entity-body drag (line body, circle body, arc body) → identical delta soft-targeted on all defining points (rigid intent).
- Circle/arc rim drag → radius soft target; center drag → translation intent.

The rigid-translation fast path is no longer a point-drag behavior. It may survive as an optimization for entity-body drags or for components the compiled program proves internally rigid (translation is then exactly the minimum-motion solution), but the general solve is the behavioral authority and the fast path must be result-equivalent.

### D6: Feedback follows DOF, not solve failure

"Constrained movement" feedback is shown when the grabbed target is fully constrained (no free DOF in its component, derivable from the compiled program), not when a solve merely failed to reach the cursor. Sliding along remaining DOF is normal successful behavior and shows no blocking feedback.

## Risks / Trade-offs

- **Perf:** the ε-term adds one quadratic residual per free point in the affected component. It is diagonal (no cross terms) and cheap analytically; benchmarks on the existing 10/50/150 fixtures gate the change. Substepping multiplies solve count on fast mouse moves — bounded by a max substep count with lag as the fallback.
- **Feel:** pure minimum-motion occasionally reads as "stiff" (linkages stretch rather than swing). Accepted deliberately; policy 2 comments mark the escape hatch if user feedback demands it.
- **Behavior change:** users who relied on point-drag translating whole free shapes must grab the entity body instead. The fully-shape-constrained square still translates from a vertex drag because translation is the only remaining DOF.
- **Contract churn:** `blocked.reason: "unsatisfied"` frequency drops drastically; downstream feedback code must key off DOF-based signals (D6) instead.

## Migration

1. Capture regression fixtures from currently misbehaving sketches (flip / refusal / drift) via the instrumented solver adapter before changing behavior.
2. Land D1 (acceptance) + D2 (regularization) behind the existing solver seams — this alone removes refusals and drift.
3. Land D3 (substepping) and D4 (remove branches) together — continuity guarantees only hold with both.
4. Land D5 (handle intent) at the editor/viewport seam.
5. Re-baseline fixtures as intended-behavior tests.
