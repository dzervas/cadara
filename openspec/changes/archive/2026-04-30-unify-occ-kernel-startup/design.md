## Context

Browser OCC startup is currently split across two execution paths:

- A worker-backed snapshot path that can preload the OpenCascade wasm runtime.
- A main-thread mutation path that can still initialize a separate OCC runtime later.

That split creates three performance problems:

1. OCC warmup starts too late because the current browser preload is triggered from a React effect after first render.
2. The preload path is shallow; it warms the wasm instance but does not prepare retained startup authoring state for the first snapshot.
3. Snapshot and mutation ownership are split, so browser sessions can pay OCC initialization twice and can replay authoritative document state through competing owners.

The change is cross-cutting because it touches bootstrap, runtime ownership, worker RPCs, and the adapter boundary.

## Goals / Non-Goals

**Goals:**
- Start mandatory OCC warmup before React mount.
- Ensure browser OCC mutations and snapshots use one runtime owner.
- Reuse retained worker authoring state for snapshots instead of replaying unchanged documents before every snapshot.
- Preserve the existing public modeling contract and error-reporting behavior.

**Non-Goals:**
- Redesign the public modeling contract.
- Introduce `SharedWorker` persistence across page reloads in this change.
- Reduce OpenCascade wasm size or replace the underlying OCC distribution.
- Rework viewport LOD policy beyond preserving the existing startup tessellation behavior.

## Decisions

### Decision: Start OCC warmup from bootstrap, not from `App` effects

Warmup will move to a module-level startup path that runs during browser bootstrap before `createRoot(...).render(...)`.

Rationale:
- React effects happen after first render and after more app code has already executed.
- OCC is mandatory, so delaying warmup to “after UI is visible” does not buy meaningful product value.

Alternatives considered:
- Keep the `useEffect` preload and only optimize worker internals.
  Rejected because the startup path would still start later than necessary.
- Add only HTML preload hints.
  Rejected as insufficient because the main issue is runtime initialization and ownership, not just asset fetch timing.

### Decision: Replace `preload()` with a real warm-start operation

The browser runtime owner will expose a warm-start operation that initializes OpenCascade and prepares the startup authoring state needed for the first snapshot. The first snapshot will consume that retained state instead of redoing cold startup work.

Rationale:
- The current preload path only proves wasm initialization succeeded; it does not eliminate the next startup step.
- A real warm-start operation aligns the eager path with the work the app always needs anyway.

Alternatives considered:
- Keep preload as “wasm only” and rely on the first snapshot call to do the rest.
  Rejected because the first snapshot remains slower than necessary.

### Decision: Make the OCC worker the sole browser runtime owner

When dedicated workers are available, the worker becomes the only browser OCC owner for initialization, document rebuilds, mutations, snapshots, and tessellation. The main thread becomes an RPC client and no longer initializes its own OCC runtime for browser mutations.

Rationale:
- The worker already owns the heavy snapshot path and keeps OCC off the main thread.
- Single ownership removes duplicate wasm initialization and state synchronization hazards.

Alternatives considered:
- Keep split ownership and add more aggressive preload on both sides.
  Rejected because it preserves duplicate initialization risk and state drift risk.
- Move everything back to the main thread.
  Rejected because it regresses UI responsiveness.

### Decision: Retain committed worker authoring state between calls

The worker runtime will keep its authoritative committed authoring state alive across warmup, restore, mutation, and snapshot requests. Snapshot requests for unchanged committed state will read from retained state rather than calling restore on every request.

Rationale:
- Rebuilding the same committed document before every snapshot is wasted work.
- Retained state is the natural companion to single runtime ownership.

Alternatives considered:
- Keep replay-per-snapshot behavior but cache only the wasm instance.
  Rejected because document replay remains a meaningful part of startup and interaction cost.

## Risks / Trade-offs

- [Worker ownership increases RPC surface area] → Mitigation: keep the public modeling contract unchanged and narrow the worker protocol to existing modeling operations plus explicit warm-start semantics.
- [Retained worker state can become stale if ownership boundaries are violated] → Mitigation: remove browser main-thread OCC mutation ownership and treat the worker as the only authoritative browser runtime owner.
- [Bootstrap warmup failures happen earlier in app startup] → Mitigation: route failures through the existing reported error path and keep the viewport loading state bounded by success or explicit failure.
- [Development ergonomics can be affected by earlier worker startup] → Mitigation: centralize worker startup in one bootstrap module so dev-only behavior stays easy to trace and test.

## Migration Plan

1. Introduce a bootstrap OCC startup module and route browser warmup through it.
2. Extend the worker protocol with a warm-start operation that prepares runtime state, not just wasm initialization.
3. Remove browser main-thread OCC runtime initialization from mutation paths and route those operations to the worker owner.
4. Replace replay-per-snapshot worker behavior with retained committed authoring state.
5. Update tests and load-time measurements to verify earlier warmup, single ownership, and snapshot reuse.

Rollback strategy:
- Re-enable the existing effect-driven preload and main-thread mutation ownership behind the prior code paths if the worker-owned runtime proves unstable.

## Open Questions

- Should warm-start cache only the empty startup authoring state, or should it also cache the first serialized startup snapshot payload?
- Which browser mutation operations need explicit new worker RPCs versus a broader “all browser modeling operations are worker-backed” transport layer?
- Should development builds disable React StrictMode worker churn separately, or is bootstrap-owned singleton startup sufficient?
