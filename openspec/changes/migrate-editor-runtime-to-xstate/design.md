## Context

The current editor runtime already behaves like a statechart system. `src/contracts/editor/state-machine.ts` defines explicit states, events, command phases, and async effects; `src/hooks/editor-provider.tsx` then runs that machine through a reducer and uses React `useEffect` to bootstrap the session and flush pending effects. This is a sound architecture, but much of the orchestration infrastructure is handwritten:

- transition logic is custom
- effect queues are custom
- async invocation and stale-result handling are custom
- lifecycle-triggered effect execution is custom

XState is a strong fit because the hard part of the problem is not whether a state machine exists; it is that the repo is already maintaining one by hand.

The user also wants this change to try to eliminate `useEffect`. That only makes sense in a scoped way. The realistic target is to eliminate or reduce orchestration-oriented `useEffect` in the editor/runtime layer, not to remove React effects from viewport, browser API, or resource lifecycle code that still properly belongs in React.

## Goals / Non-Goals

**Goals:**
- Replace the custom editor runtime orchestration with XState statecharts/actors.
- Preserve current command semantics, effect ordering, and stale-response safety.
- Move orchestration-specific side effects out of React `useEffect` and into machine-owned invocation/lifecycle logic.
- Keep the modeling-service boundary and existing editor/domain contracts intact wherever practical.
- Improve clarity around cancellation, in-flight requests, and entry/exit behavior for command states.

**Non-Goals:**
- Removing every `useEffect` from the codebase.
- Rewriting viewport lifecycle, Three.js setup, or browser-event resource management into XState unless those concerns are already part of editor/runtime orchestration.
- Changing product behavior for sketch entry, feature authoring, selection semantics, or modeling-service payloads.
- Forcing unrelated local UI state, simple presentational state, or one-off DOM concerns into XState.

## Decisions

### Migrate the editor runtime, not the entire app state model

The change should focus on the editor/runtime orchestration layer currently centered on `state-machine.ts` and `editor-provider.tsx`. That is where the repo is already paying the cost of a custom statechart implementation.

This is preferable to a broad app-wide XState rollout because the strongest fit and code-reduction opportunity are localized there.

Alternative considered:
- Introduce XState as a global app state solution. Too broad, weakens migration focus, and risks pulling simple UI state into the wrong abstraction.

### Treat `useEffect` reduction as an implementation outcome, not the primary requirement

The proposal should explicitly aim to reduce orchestration-focused `useEffect` by moving bootstrapping, async effect execution, and lifecycle-driven command work into XState actors and invocations. It should not promise to remove every effect in React components.

This is preferable to a blanket “remove useEffect” goal because many effects represent correct DOM or browser-resource lifecycle ownership and should remain in React.

Alternative considered:
- Define success as eliminating `useEffect` broadly. This would distort scope and encourage incorrect migrations of resource lifecycle code.

### Preserve the modeling-service boundary as the invoked effect surface

The machine should continue to call the frontend-facing modeling service boundary for durable actions, snapshot fetches, previews, and reference resolution. XState should replace orchestration glue, not bypass the existing service boundary.

This is preferable to coupling the new machine directly to kernel implementations because the current architecture correctly keeps durable modeling actions behind a frontend boundary.

Alternative considered:
- Collapse orchestration and modeling-service layers during migration. This would violate an existing architectural boundary and increase risk without reducing meaningful code.

### Keep domain-rich payloads and helper logic outside the machine definition where possible

Feature-editing logic, sketch-session logic, selection filtering, and other CAD/domain helpers should stay in their existing modules and be called by the machine. XState should own flow orchestration, state transitions, invocation, and effect lifecycle rather than absorbing all domain logic into one giant machine file.

This is preferable to moving every helper into the machine because the current helper modules encode product semantics that are useful independently of orchestration.

Alternative considered:
- Rewrite all helper logic inline in XState actions and guards. This would create a harder-to-maintain machine and shrink the benefits of the migration.

### Model async work through invoked actors/services with explicit cancellation

Current async work such as snapshot load, sketch open, feature hydration, preview evaluation, and commits should be expressed as invoked actors/services owned by explicit machine states. Cancellation and stale results should be handled through machine lifecycle rather than a custom effect queue.

This is preferable to keeping a pending-effects array plus React-driven flush loop because XState already provides the lifecycle model the current code is emulating.

Alternative considered:
- Keep the current effect runner and use XState only for pure transitions. That would preserve too much custom orchestration code and miss the main point of the migration.

## Risks / Trade-offs

- [The migration may temporarily duplicate the old machine and the new XState machine] → Mitigate by migrating the provider/runtime boundary first and then folding transition logic over in slices.
- [An overly large machine file could become harder to read than the current code] → Mitigate by keeping domain helpers separate and organizing machine actions, guards, and services by workflow.
- [Developers may start forcing unrelated UI state into XState] → Mitigate by scoping the proposal clearly to editor/runtime orchestration and documenting non-goals.
- [Some React effects will still remain, which can look like incomplete migration] → Mitigate by defining success as reducing orchestration `useEffect`, not eliminating all effects.

## Migration Plan

1. Add `xstate` and introduce an XState-based editor runtime provider adjacent to the existing implementation.
2. Port session bootstrap and pending async effect execution from React `useEffect` into machine-owned invocation/lifecycle behavior.
3. Port command workflows and async effect branches in slices, preserving current events and modeling-service calls.
4. Replace the old custom reducer/effect runner once parity tests pass.
5. Leave non-orchestration React effects in place unless a specific one becomes unnecessary as a direct result of the migration.

Rollback:
- Restore the existing reducer/effect-runner provider and disable the XState provider path.
- Because the migration changes orchestration internals rather than persisted contracts, rollback is implementation-local.

## Open Questions

- Whether the existing event names and payloads should remain the machine-facing API or be normalized during the XState migration.
- Whether one top-level machine is sufficient or whether sketch and feature authoring should become child actors under a coordinating root machine.
- Whether the repo wants to keep a pure transition-layer test surface in parallel with machine integration tests or move primarily to machine-level tests.
