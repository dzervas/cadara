## Why

Direct sketch drag currently rebuilds and solves the full sketch constraint system for each accepted pointer frame, then derives regions immediately. That is workable for small sketches, but it will not hold up for production CAD workflows where dense sketches, projected references, and constrained dragging must stay interactive and predictable.

The opportunity is to make sketch solving explicitly incremental: compile stable solver structure once, warm-start from the previous solved state, solve only affected components during interactive edits, and derive regions only when the solved sketch has been static long enough to make profile work useful.

## What Changes

- Add a compiled sketch solve runtime that separates immutable graph/equation structure from mutable numeric values, drag targets, statuses, and result buffers.
- Add component-aware interactive solving so dragging one point solves only the connected solver component affected by that edit, while unaffected components preserve their previous solved values.
- Add warm-start behavior that uses the prior solved snapshot or prior interactive frame as the next solve's initial numeric state.
- Add deterministic invalidation rules for compiled solve sessions when authored points, entities, constraints, dimensions, projected references, tolerances, or solve strategy change.
- Add region-extraction scheduling semantics for active sketch editing so live regions are refreshed after the sketch is static, on drag end, or when a workflow explicitly requires current profiles.
- **BREAKING**: Split mandatory region derivation out of the regular solve response contract. Region extraction becomes an explicit operation or a caller-selected solve option rather than unconditional work for every solve.
- **BREAKING**: Replace the advisory `incrementalEdit` hint with a clearer incremental/session contract that exposes when the solver can reuse compiled structure and when callers must start a new solve session.
- Preserve explicit diagnostics and failure behavior: invalid, inconsistent, missing-reference, and non-convergent cases must remain machine-readable and must not be swallowed.

Assumptions:

- Backwards compatibility with the current solver request/response shape is intentionally not required.
- The first production target is in-process TypeScript solving; worker offload can be enabled later if the compiled/session contract is clean.
- Region extraction can be temporarily stale during pointer movement as long as the editor makes it current before profile-dependent actions and after drag settlement.

## Capabilities

### New Capabilities

- `sketch-solver-incremental-runtime`: Compiled solve programs, warm-started interactive sessions, affected-component solving, reusable numeric buffers, and session invalidation behavior.

### Modified Capabilities

- `sketch-constraint-solver`: Change solve contracts so solving and region derivation are decoupled, and replace advisory incremental hints with explicit interactive solve lifecycle semantics.
- `sketch-geometry-editing`: Change direct constrained drag behavior to use warm-started component solves and delayed live-region refresh without corrupting draft geometry.

## Impact

- Affects solver contracts under `src/contracts/solver/` and runtime validation schemas.
- Affects sketch solver internals under `src/contracts/sketch/solver-core.ts` and related benchmark coverage.
- Affects sketch-session drag state and region refresh behavior under `src/domain/editor/sketch-session/`.
- Affects solver adapters under `src/domain/solver/` and modeling-service call sites that currently expect every solve response to include `derivedRegions`.
- Affects tests for solver contracts, direct sketch geometry dragging, region extraction timing, and benchmark expectations.
