## 1. Bootstrap Warmup

- [x] 1.1 Add a bootstrap-owned OCC startup module that begins browser OCC warmup before React mount.
- [x] 1.2 Replace the `App` effect-driven preload entry point with the bootstrap warmup path while preserving existing error reporting.
- [x] 1.3 Update preload-related tests to assert bootstrap-triggered startup rather than post-render effect startup.

## 2. Worker Warm-Start Semantics

- [x] 2.1 Extend the OCC worker protocol and client to expose a warm-start operation that prepares runtime state instead of only wasm initialization.
- [x] 2.2 Update the worker runtime to initialize OpenCascade, create or prepare the retained startup authoring state, and acknowledge warm-start completion.
- [x] 2.3 Add worker/runtime tests covering successful warm-start, failure reporting, and idempotent repeated warm-start calls.

## 3. Single Browser OCC Owner

- [x] 3.1 Refactor the browser OCC adapter paths so snapshot and mutation operations route through one worker-owned OCC runtime.
- [x] 3.2 Remove or bypass browser main-thread OCC runtime initialization for mutation flows that currently call `getRuntimeState()` directly.
- [x] 3.3 Add adapter tests proving browser mutations do not initialize a second OCC runtime when worker ownership is available.

## 4. Retained Worker State Reuse

- [x] 4.1 Change the worker snapshot path to reuse retained committed authoring state instead of restoring unchanged documents before every snapshot.
- [x] 4.2 Ensure restore and mutation requests update the retained worker authoring state so later snapshots read authoritative committed state.
- [x] 4.3 Add tests covering snapshot reuse after warm-start, after restore, and after accepted mutations.

## 5. Verification

- [x] 5.1 Update or add load-time instrumentation to measure bootstrap warmup, first OCC-backed snapshot readiness, and post-startup mutation latency.
- [x] 5.2 Run targeted Bun tests for OCC preload, worker runtime, and kernel adapter behavior.
- [x] 5.3 Run the existing browser load-time or e2e harness and compare results against the current startup baseline.
