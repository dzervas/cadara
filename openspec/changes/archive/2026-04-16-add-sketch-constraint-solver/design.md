## Context

The repository already separates authored sketch data (`src/contracts/sketch`) from the public solver boundary (`src/contracts/solver`) and kernel adapters. What is missing is a real 2D solving engine. The current mock adapter treats authored point positions as already solved, so it cannot satisfy constraints or serve as a faithful basis for later sketch authoring features.

The upstream Rust implementation uses a compact parameterization:
- sketch points contribute 2 degrees of freedom each
- lines reference points and contribute no additional parameters
- arcs contribute center-point references plus radius/start-angle/end-angle parameters
- each constraint is modeled as a scalar least-squares loss `0.5 * err^2`
- gradients are derived analytically and accumulated onto the underlying parameter vector
- iterative solvers work over a flattened numeric state via get/set data operations

That architecture fits this codebase well because it keeps all math inside the sketch domain and lets the existing solver boundary remain unchanged.

## Goals / Non-Goals

**Goals:**
- Add a sketch-only TypeScript solving module that depends only on sketch contracts and local numeric helpers.
- Preserve the current `SketchSolverAdapter` contract so modeling code and kernel adapters do not gain solver-specific coupling.
- Extend the sketch schema only where the solver requires additional authored constraint vocabulary.
- Port the upstream mathematical tests into TypeScript with equivalent fixtures and assertions.

**Non-Goals:**
- Introduce kernel-specific geometry, OCC types, or UI/editor concepts into the solver module.
- Implement every upstream primitive or decomposition feature if it is not needed for the current sketch contract.
- Add external numeric dependencies unless the port cannot be implemented reasonably with local helpers.

## Decisions

### Keep the math engine under the sketch contract tree
The new solver core will live under `src/contracts/sketch/` so its public inputs and outputs are the authored and solved sketch schema types. A thin adapter in `src/domain/solver/` will translate `SketchSolverAdapter` requests into calls to that core.

Alternative considered: extending the existing mock adapter in place. Rejected because it mixes placeholder projection/region behavior with real solve math and keeps the algorithm outside the sketch contract area the user explicitly wants.

### Mirror the upstream least-squares formulation
Each supported constraint or dimension will expose:
- a scalar loss function
- an analytical gradient against the flattened parameter vector

The first implementation will use a BFGS-based solve loop with Wolfe-style line search, matching the strongest upstream convergence coverage and avoiding an immediate dependency on matrix-heavy pseudo-inverse logic. The helper layer will still expose loss vectors and Jacobian assembly so Gauss-Newton / Levenberg-Marquardt style ports remain possible later.

Alternative considered: implementing only direct coordinate projection rules for horizontal/vertical/distance. Rejected because it would not preserve the upstream math model or support the direct test ports.

### Expand the authored sketch schema to cover solver-facing constraints explicitly
The current contract only supports `coincident`, `horizontal`, `vertical`, `distance`, and `circleRadius`. The direct test ports require additional authored facts, so the contract will be extended with:
- line constraints: `parallel`, `perpendicular`, `equalLength`
- angle constraint over three points
- directional point distances for horizontal/vertical dimensions
- explicit arc start/end coincidence constraints

This keeps the solver interacting only with typed authored sketch data rather than side-channel fixtures.

Alternative considered: keeping those constructs as test-only internal types. Rejected because the solver would then not actually be driven by the sketch contract.

### Keep projection in the adapter but move region extraction into the sketch contract
The sketch-only module will own validation, solving, and ring/region extraction. The adapter will continue to own request envelope handling, external reference projection stubs, and reference-resolution wiring, but it should consume sketch-domain region extraction rather than reimplementing loop traversal internally.

### Add alternative solve strategies behind the same sketch-domain input model
The sketch-only module will expose multiple iterative solve strategies over the same residual and gradient definitions:
- gradient descent with Wolfe line search
- BFGS
- Gauss-Newton
- Levenberg-Marquardt

The first-class public result still uses the same solved sketch schema, but direct tests can verify that multiple strategies solve the canonical fixtures.

## Risks / Trade-offs

- [Analytical gradient bugs can produce convincing but wrong convergence] -> Mitigate with direct ports of the upstream gradient-sensitive tests and rectangle fixtures.
- [The expanded sketch schema increases near-term contract surface] -> Mitigate by keeping each new authored variant tightly solver-facing and documenting behavior in a dedicated spec.
- [Real solve loops may classify some existing mock fixtures differently] -> Mitigate by preserving current validation/projection behavior and only replacing solve internals where the math is authoritative.
- [BFGS without good initialization can struggle on degenerate inputs] -> Mitigate by carrying over the upstream line search behavior and preserving partial/failure statuses with diagnostics.

## Migration Plan

1. Add the spec and contract vocabulary for the sketch solver capability.
2. Implement the sketch-only solver core and its direct tests.
3. Introduce a dedicated adapter that satisfies `SketchSolverAdapter`.
4. Switch app/runtime wiring from the placeholder adapter to the new adapter where appropriate.
5. Keep the older mock adapter only for fixtures that intentionally need stub behavior, or remove it if the real adapter covers those cases cleanly.

## Open Questions

- Whether circle-specific and arc-specific constraints beyond the direct test ports should be added now or deferred until sketch tools need them.
- Whether to keep the existing mock adapter as a lightweight validation fixture after the real solver lands.
