## Why

OpenCascade initialization is currently split across a worker-owned snapshot path and a separate main-thread mutation path. That raises cold-start latency, allows duplicate OCC initialization in a single browser session, and forces users to wait longer before the mandatory kernel is ready.

## What Changes

- Start mandatory OCC warmup during bootstrap module execution instead of waiting for a React effect after the first render.
- Replace the current preload-only fetch and instantiate path with a real warm-start path that initializes the active OCC runtime owner and prepares the startup authoring state needed for the first snapshot.
- Consolidate browser OCC ownership so one long-lived runtime owner handles both mutations and snapshot generation instead of allowing a second main-thread OCC runtime to initialize later.
- Keep worker-based OCC execution as the preferred browser path, but change it from repeated document rebuilds per snapshot to a retained authoring-state model.
- Preserve the existing error-reporting contract while making startup failures and ownership failures explicit.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `occ-initial-render-latency`: tighten the startup contract so OCC warmup begins during bootstrap, the warm path prepares the startup runtime state, and the first snapshot reuses that state instead of paying redundant initialization work.
- `occ-kernel-adapter`: require a single browser OCC runtime owner for snapshot and mutation operations so the adapter does not initialize a second OCC runtime or replay authoritative document state through competing owners.

## Impact

- Affected code: `src/bootstrap.tsx`, `src/App.tsx`, `src/domain/modeling/opencascade-kernel-adapter.ts`, `src/domain/modeling/occ/worker.ts`, `src/domain/modeling/occ/worker-client.ts`, and related preload/runtime modules.
- Affected runtime behavior: browser OCC startup, initial snapshot generation, mutation execution ownership, and worker snapshot reuse.
- Dependencies and systems: OpenCascade wasm runtime loading, browser workers, React bootstrap flow, and existing error reporting.
