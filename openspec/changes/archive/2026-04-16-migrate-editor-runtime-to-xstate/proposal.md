## Why

The editor runtime currently implements its own state-machine and side-effect runner through a large reducer-style transition module plus `useEffect`-driven orchestration in React. That duplicates capabilities XState already provides for explicit statecharts, invoked async work, cancellation, and lifecycle-aware side effects, and it leaves orchestration logic harder to evolve than the underlying CAD behavior.

## What Changes

- Adopt XState for the editor/runtime orchestration layer that currently lives in the custom editor state machine and provider runtime.
- Move command/session orchestration, async snapshot loading, sketch-open flows, feature hydration, preview evaluation, and commit effects into XState-owned states, actors, and invoked services.
- Preserve existing editor behavior, command semantics, sketch-plane behavior, and modeling-service boundaries while changing the runtime implementation.
- Reduce orchestration-focused React `useEffect` usage as a side effect of moving runtime effects into the XState machine lifecycle.
- Keep DOM/resource lifecycle effects outside the machine when they are truly React or browser lifecycle concerns rather than command orchestration concerns.

## Capabilities

### New Capabilities
- `editor-runtime-orchestration`: The editor runtime uses an explicit statechart/actor orchestration model for command flows, async effects, and cancellation.

### Modified Capabilities
- `frontend-modeling-boundary`: Frontend durable modeling actions continue to pass through the modeling service boundary, but runtime orchestration now executes through a statechart-owned effect model rather than a custom reducer-plus-`useEffect` runner.

## Impact

- Affected code includes `src/contracts/editor/state-machine.ts`, `src/hooks/editor-provider.tsx`, editor-facing runtime hooks, and tests covering command transitions and async effect handling.
- Adds a new dependency on `xstate`.
- Expected to reduce custom orchestration code and a meaningful share of orchestration-specific `useEffect` usage, but not to remove all React effects from the application.
- Does not change modeling contracts, viewport semantics, sketch-plane contracts, or kernel behavior.
