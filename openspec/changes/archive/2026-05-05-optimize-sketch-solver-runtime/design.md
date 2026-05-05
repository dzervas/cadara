## Context

The current sketch solver is a stateless function over `SketchDefinition`. Each constrained drag frame evaluates derivations, validates the full sketch, rebuilds point/entity maps, creates scalar constraint closures, allocates gradients and dense matrices, solves the full system, builds full statuses, applies solved point positions back to the draft, and immediately derives regions.

Viewport pointer moves are already coalesced to one drag update per animation frame, and display/BVH churn has already been reduced. The remaining latency and robustness risk is now inside the solver/runtime boundary: work that is structural at drag start is being repeated as numeric work on every drag frame, and profile extraction is coupled to every accepted direct edit.

Backwards compatibility is intentionally out of scope for this change. The solver contract can change if doing so makes the runtime clearer, faster, and easier to harden.

## Goals / Non-Goals

**Goals:**

- Compile stable solver structure once per compatible sketch graph and reuse it across interactive drag frames.
- Warm-start solves from the prior solved state, including auxiliary variables, not just authored point positions.
- Partition the compiled solve graph into affected components and solve only the component touched by an interactive edit.
- Keep solver data flat and reusable on hot paths, using typed arrays and reusable status/result buffers where practical.
- Decouple normal solve responses from region extraction so pointer movement does not perform profile work unless the caller explicitly requests it.
- Provide deterministic invalidation rules for when compiled sessions must be rebuilt.
- Preserve explicit diagnostics for malformed input, invalid references, conflicts, non-convergence, and stale solve-session use.

**Non-Goals:**

- Replacing all constraint math with a new external solver library.
- Moving the solver to a worker thread in this change.
- Adding new sketch constraint types or authoring tools.
- Making region extraction approximate or silently stale for profile-dependent operations.
- Changing the visual CAD shell, picking model, or viewport coalescing behavior except where needed to consume the new solver/session contract.

## Decisions

1. Introduce a compiled solver program separate from solve sessions.

   The compiled program owns structural data: ordered variables, equation records, variable-to-equation adjacency, component partitions, projected-reference bindings, and function pointers or operation codes needed to evaluate residuals. Mutable numeric values, drag target values, iteration scratch space, per-equation losses, statuses, and output buffers live in a solve session.

   Rationale: most current per-frame work is structural. Separating program from session lets drag updates mutate only numeric state and avoids rebuilding maps, closures, arrays, and matrices for a graph that has not changed.

   Alternative considered: cache the current `buildSystem` result. That would reduce some allocation, but the existing closure-heavy shape still makes component solves and reusable buffers awkward.

2. Treat interactive drag as an explicit lifecycle.

   The editor starts an interactive solve session at drag start using the current sketch definition, projected references, tolerances, strategy, and optional prior solved snapshot. Each drag move updates the session's temporary target and requests an interactive solve. Drag end either finalizes the latest accepted solved state or disposes the session without committing invalid geometry.

   Rationale: the current `dragTarget` field on a stateless `solveSketch` request cannot carry compiled structure, frame-to-frame numeric state, or session invalidation semantics clearly.

   Alternative considered: keep `incrementalEdit` advisory and make the adapter opportunistically cache. That hides important lifecycle and invalidation behavior, making correctness harder to test and stale-session bugs harder to diagnose.

3. Partition the compiled system by solver variables and equations, not only authored points.

   Components must include point variables, auxiliary circle/arc variables, dimensions, constraints, local entities, and projected-reference anchors that participate in an equation. A drag target selects affected variables through this bipartite graph. Unaffected components retain their prior values and statuses unless the request asks for a full solve.

   Rationale: point-only connectivity misses circles, arcs, dimensions to datums/projected references, symmetry axes, and derived relationships that can anchor or couple motion.

   Alternative considered: reuse the current connected-point graph from the translation shortcut. That graph is useful for a narrow translation optimization, but it is not a complete solver dependency graph.

4. Make region extraction explicit and schedulable.

   Regular solve responses return solved geometry, status, and diagnostics. Region extraction runs through a separate request or an explicit solve option. Active sketch editing should refresh live regions after the sketch is static for a short debounce window, at drag end, and immediately before operations that require current profiles.

   Rationale: regions are profile/topology work, not required for every pointer frame. Decoupling allows responsive dragging while preserving correctness at workflow boundaries.

   Alternative considered: keep regions in every solve response and throttle only in the editor. That still forces service/adapters to compute regions for callers that do not need them, and it keeps the contract misleading about the cost of solving.

5. Preserve full diagnostics while optimizing hot paths.

   Interactive solves may compute compact per-component statuses during movement, but finalization and explicit full solves must produce complete solved snapshots, statuses, and diagnostics. Stale compiled sessions, graph mismatches, missing projected references, invalid input, and non-convergence must be reported through machine-readable diagnostics or thrown contract errors at the boundary where the request is invalid.

   Rationale: production readiness is as much about failure clarity as speed. The project rule against silencing unhandled exceptions still applies.

   Alternative considered: skip status/diagnostic work during drag entirely. That would be faster, but it would make blocked drags and invalid references hard to explain.

## Risks / Trade-offs

- [Component partitioning misses an implicit dependency] -> Build partitioning from the compiled equation-variable graph and add fixtures for datums, projected references, circles, arcs, dimensions, symmetry, and derived relationships.
- [Warm starts preserve a bad local minimum] -> Allow finalization/full solve to re-run broader solve when residuals exceed tolerance, and expose non-convergence diagnostics rather than committing invalid geometry.
- [Deferred regions make UI feedback stale] -> Track live-region freshness separately and force immediate extraction before profile-dependent operations and after drag settlement.
- [Session lifecycle adds stateful complexity] -> Keep compile/session APIs in domain/contracts, avoid leaking them into presentational components, and make invalidation deterministic and testable.
- [Dense sketches still exceed main-thread frame budgets] -> Design the session contract so future worker offload can move compiled sessions behind an adapter without changing editor behavior.

## Migration Plan

1. Add the new solver contract types and runtime schemas for compiled/interactive solve lifecycle and optional/explicit region extraction.
2. Refactor solver internals to build a compiled program with flat variable/equation metadata and reusable numeric session state.
3. Add component partitioning and warm-started interactive solve paths, preserving existing full-solve behavior through the new program/session core.
4. Update solver adapters and modeling-service call sites so normal solves no longer assume regions are included.
5. Update sketch-session drag state to own or reference an interactive solve session and to debounce live-region refresh.
6. Add focused logic tests and benchmark coverage for warm starts, component isolation, invalidation, blocked drags, delayed region refresh, and unchanged final-region correctness.
7. Remove obsolete advisory incremental request fields once all callers use the explicit lifecycle.

Rollback is a code revert while the change is in progress. After the breaking contract lands, rollback also requires reverting call sites that have moved to explicit region extraction and interactive solve sessions.

## Open Questions

- Should the initial implementation expose compiled sessions only in-process, or should the public adapter contract already model opaque session IDs for a future worker/backend solver?
- What debounce value should active sketch region refresh use by default? The working assumption is about 100 ms of sketch inactivity, with immediate refresh on drag end and profile-dependent actions.
