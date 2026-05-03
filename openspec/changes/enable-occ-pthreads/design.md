## Context

The browser OCC runtime already runs behind a dedicated worker boundary, and that worker is the sole browser runtime owner for startup, rebuilds, mutations, snapshots, and tessellation. However, the custom OpenCascade build delivered through `cadara-occ.js` and `cadara-occ.wasm` is still single-threaded, so every heavy OCC operation remains bound to one CPU core even after it leaves the main thread.

This change is intentionally narrower than a broader runtime-ownership redesign. The user selected pthread-enabled OCC and explicitly did not ask for a `SharedWorker` transport or compatibility-preserving fallback path. That lets the design keep the current one-page-to-one-runtime-owner shape while changing only the internals of the browser OCC runtime and the platform prerequisites needed to start it.

The change is cross-cutting because it touches the custom OCC build recipe, runtime asset resolution, dev/prod server headers, deployment configuration, worker startup behavior, and performance validation.

## Goals / Non-Goals

**Goals:**
- Enable Emscripten pthread support in the custom browser OCC build.
- Keep the dedicated OCC worker as the sole browser runtime owner while allowing OCC internals to use multiple threads.
- Make browser startup reject unsupported threading environments explicitly instead of silently using a slower non-threaded runtime.
- Deliver any additional pthread helper assets correctly in dev, preview, and production.
- Verify that representative OCC-heavy operations benefit materially enough to justify the added platform requirements.

**Non-Goals:**
- Introduce `SharedWorker` runtime ownership or cross-tab OCC sharing.
- Preserve a browser fallback path that runs a non-threaded OCC build.
- Redesign the public modeling contract or OCC worker RPC contract beyond what pthread startup requires.
- Tune individual OCC algorithms beyond measuring candidate operations and preserving room for follow-on optimization work.

## Decisions

### Decision: Keep the dedicated OCC worker and add internal OCC threading

The browser will continue to create one dedicated OCC worker per page, and the custom OpenCascade build loaded inside that worker will use Emscripten pthreads for internal parallel work.

Rationale:
- The current runtime already has one authoritative browser OCC owner, so transport and ownership are not the main bottleneck.
- Pthread support targets heavy OCC execution directly without adding multi-client coordination complexity.
- This keeps the current adapter and worker protocol mostly stable while still changing the runtime’s execution model where the work actually happens.

Alternatives considered:
- Move to `SharedWorker` at the same time.
  Rejected because it mixes internal OCC threading with a separate runtime-ownership redesign.
- Keep single-threaded OCC and only add more coarse-grained workers outside the kernel.
  Rejected because it duplicates state and coordination without letting OCC internals parallelize.

### Decision: Treat pthread-capable startup prerequisites as mandatory

Browser OCC startup will require a cross-origin-isolated environment and any other prerequisites needed for shared-memory WebAssembly threading. If those prerequisites are not met, startup will fail through the existing application error path instead of selecting a different browser OCC runtime.

Rationale:
- The user explicitly removed backward-compatibility constraints.
- Mixed runtime modes would make performance, testing, and debugging inconsistent across environments.
- A hard requirement keeps the system honest about what runtime it is actually designed to run.

Alternatives considered:
- Preserve a non-threaded fallback runtime.
  Rejected because it reintroduces split behavior and undermines the point of the change.
- Gate pthreads behind a feature flag while defaulting to the old runtime indefinitely.
  Rejected because it postpones the platform decision without simplifying implementation.

### Decision: Extend app-owned OCC asset delivery to cover pthread helper workers

The application-owned OCC asset set will expand beyond `cadara-occ.js` and `cadara-occ.wasm` to include any helper worker assets required by the pthread-enabled build. Runtime asset resolution, cache headers, and deployment serving rules will treat those assets as first-class app-owned runtime artifacts.

Rationale:
- Emscripten pthread builds rely on helper worker scripts in addition to the wasm and bootstrap module.
- The repo already moved away from CDN/runtime split-brain; pthread assets should follow the same app-owned delivery model.
- Dev, preview, and production need one consistent asset story or startup behavior will drift by environment.

Alternatives considered:
- Let the threaded runtime fetch helper workers from toolchain defaults or third-party paths.
  Rejected because it weakens deployment control and increases environment drift.
- Bundle helper workers indirectly inside the main application chunks.
  Rejected because worker delivery bugs already showed that opaque bundling patterns are fragile here.

### Decision: Prove value with targeted OCC benchmarks before follow-on tuning

The change will include benchmark and validation work for a small set of representative heavy OCC operations such as initial snapshot preparation, tessellation-heavy snapshot generation, and export or rebuild paths that are expected to benefit from internal threading.

Rationale:
- Pthread support adds platform and operational cost.
- The repo needs evidence that the custom build and startup complexity buy meaningful modeling-time wins.
- The benchmark set will guide any follow-on work on thread-pool sizing or operation-specific tuning.

Alternatives considered:
- Ship pthread support without measurement and optimize later if users complain.
  Rejected because the added browser constraints are too explicit to justify on faith alone.

## Risks / Trade-offs

- [Cross-origin isolation blocks resources or integrations that are currently loadable] → Mitigation: inventory runtime-critical resources early, keep the OCC asset path app-owned, and make failure modes explicit in dev and production.
- [Threaded OCC increases memory pressure because each page keeps a worker-owned runtime plus thread-pool overhead] → Mitigation: benchmark memory alongside latency and keep the change scoped so thread-pool tuning can follow from real measurements.
- [Dev and E2E environments drift from production if headers or helper-worker serving differ] → Mitigation: make dev, preview, and production share one explicit header and asset-delivery contract.
- [Some OCC operations may not speed up materially even with pthread support] → Mitigation: require targeted benchmarks and treat the first change as enabling infrastructure plus measurement, not as proof that every OCC path improves.
- [Worker startup or asset resolution regressions could leave the app in an unusable state] → Mitigation: preserve the existing reported error path and validate startup failures explicitly before applying follow-on modeling changes.

## Migration Plan

1. Update the custom OpenCascade build recipe to emit a pthread-enabled browser distribution and any required helper-worker assets.
2. Extend runtime asset resolution and worker startup to load the threaded OCC runtime deterministically from app-owned assets.
3. Add the required response headers and serving rules in local dev, preview, and deployment configuration so browser pages and workers can start the threaded runtime.
4. Remove non-threaded browser OCC startup paths and replace them with explicit startup failures when prerequisites are not met.
5. Validate startup, snapshot, and representative heavy-operation benchmarks in dev and production-like environments.

Rollback strategy:
- Revert the change by restoring the previous single-threaded custom OCC build and the prior runtime asset configuration if the pthread-enabled build proves unstable or does not deliver enough value.

## Open Questions

- Which OCC operations in this codebase actually benefit enough from pthread execution to justify later thread-pool tuning?
- Does the chosen OpenCascade.js / Emscripten toolchain emit one helper worker script or multiple auxiliary assets that need first-class deployment handling?
- Are there any current same-origin resources loaded by the app or runtime path that will fail under the required embedder policy and need explicit header adjustments?
