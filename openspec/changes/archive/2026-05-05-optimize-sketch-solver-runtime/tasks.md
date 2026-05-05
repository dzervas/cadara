## 1. Contract And Schema

- [x] 1.1 Replace the advisory solver incremental hint with explicit compiled/interactive solve lifecycle types in `src/contracts/solver/`.
- [x] 1.2 Update solver runtime schemas and contract tests for interactive session start, update, finalize, dispose, stale-session rejection, and solve-without-regions responses.
- [x] 1.3 Update modeling-service and solver-adapter interfaces so region extraction is explicit or caller-selected instead of mandatory in every solve response.

## 2. Compiled Solver Program

- [x] 2.1 Refactor solver system construction into a compiled program containing stable variable ordering, equation metadata, projected-reference bindings, and component dependency data.
- [x] 2.2 Move mutable numeric values, residuals, gradients, losses, statuses, and output buffers into reusable solve-session state.
- [x] 2.3 Add deterministic compatibility and invalidation checks for graph, projected reference, tolerance, and strategy changes.
- [x] 2.4 Preserve full-solve behavior by routing existing supported constraints, dimensions, solved entities, statuses, and diagnostics through the compiled-program path.

## 3. Interactive Component Solving

- [x] 3.1 Implement warm-start seeding from compatible solved snapshots and from previous interactive frames, including auxiliary circle and arc variables.
- [x] 3.2 Build component partitioning from the compiled equation-variable graph rather than point-only connectivity.
- [x] 3.3 Implement interactive drag updates that solve only the affected component and preserve unaffected component values.
- [x] 3.4 Preserve blocked, unsatisfied, missing-reference, stale-session, and non-convergent diagnostics for interactive solve failures.

## 4. Region Extraction Decoupling

- [x] 4.1 Remove unconditional region derivation from normal solve responses and update all call sites that currently expect `derivedRegions`.
- [x] 4.2 Keep explicit `deriveSketchRegions` behavior available for solved snapshots, committed sketch workflows, and profile-dependent operations.
- [x] 4.3 Add active sketch live-region freshness state and debounce refresh after direct drag movement settles.
- [x] 4.4 Force immediate live-region refresh on drag end and before sketch commit or profile-dependent feature selection consumes regions.

## 5. Editor Integration

- [x] 5.1 Extend sketch-session drag state to own or reference the active interactive solve session without leaking solver internals into presentational components.
- [x] 5.2 Update constrained direct drag to start, update, finalize, and dispose interactive solve sessions.
- [x] 5.3 Ensure blocked drags leave authored draft geometry and current live regions unchanged while preserving visible constrained-movement feedback.
- [x] 5.4 Keep existing unconstrained direct point dragging on the lightweight authored-position path.

## 6. Tests And Benchmarks

- [x] 6.1 Read `docs/testing.md` before test edits and classify coverage lanes before adding or modifying tests.
- [x] 6.2 Add logic tests for compiled solve reuse, warm starts, session invalidation, stale-session rejection, and solve-without-region responses.
- [x] 6.3 Add logic tests for component isolation across independent sketch components, including circles, arcs, dimensions, projected references, symmetry, and datums.
- [x] 6.4 Add editor/session tests for constrained drag lifecycle, blocked drag preservation, deferred region refresh, drag-end refresh, and profile-dependent immediate refresh.
- [x] 6.5 Extend solver benchmarks to report full-solve and interactive drag-frame timing for representative 10, 50, and 150 constraint sketches plus an independent-component fixture.
- [x] 6.6 Run `bun run test:all` and address failures before marking the change complete.
