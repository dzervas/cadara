## Context

CADara already has production Sentry error reporting and release/source-map wiring, but performance work is currently split between local benchmark scripts and a temporary browser `__cadOccPerf` bridge. That bridge measures startup readiness for controlled benchmark runs, while the live product still lacks sampled visibility into slow OCC worker operations, sketch solves, document snapshots, document persistence, and first geometry render.

The user explicitly wants helpful kernel and sketch-solver performance data without littering many internal functions with metric code. The architecture already has natural seams: the OCC worker client, modeling service, sketch-solver service facade, document repository, and viewport readiness lifecycle. The design should use those boundaries and drop metrics that require expensive traversal or large code changes.

## Goals / Non-Goals

**Goals:**

- Add a small performance telemetry contract with a no-op implementation and a Sentry tracing implementation.
- Capture sampled spans at seam wrappers rather than direct `Sentry.*` calls in domain internals.
- Measure startup phases: canvas created, OCC warmup settled, first workspace snapshot ready, and first non-empty geometry frame.
- Measure OCC worker operations by operation kind at the worker/client boundary.
- Measure modeling-service operations by operation name, result classification, and cheap document complexity counts.
- Measure sketch-solver operations by solver operation, including solve, validation, region extraction, and aggregate drag-gesture timing.
- Measure document repository operations by operation kind, duration, result classification, storage source, and repository head count.
- Keep attributes low-cardinality and cheap to read at the seam.
- Preserve disabled/no-op behavior when Sentry tracing is unavailable or not enabled.

**Non-Goals:**

- Adding direct telemetry calls inside individual OCC feature implementations, topology builders, solver residuals, solver iteration loops, render mesh builders, or pointer-move handlers.
- Emitting one Sentry span per sketch pointer move.
- Calculating full Automerge version counts, full document byte sizes, topology graph complexity, mesh triangle totals, per-face/per-edge counts, or expensive derived geometry summaries.
- Changing kernel topology behavior, sketch solving behavior, document repository semantics, or viewport rendering semantics for the sake of telemetry.
- Adding a new telemetry vendor, metrics SDK, analytics backend, or custom batching pipeline.
- Guaranteeing every timing span is recorded; production telemetry is sampled.

## Decisions

### Decision: Use a small app-owned telemetry contract

Introduce an app-owned `PerformanceTelemetry` boundary that exposes a minimal span API and no-op implementation. The rest of the codebase depends on that boundary, while the Sentry adapter is the only production implementation that imports `@sentry/browser` tracing APIs.

Alternative considered: call `Sentry.startSpan` directly from each seam. That is simpler initially, but it spreads vendor code into domain/application modules and makes disabled-mode behavior harder to test consistently.

### Decision: Instrument by wrapper/decorator at existing seams

Instrumentation should be applied by wrappers around `OccWorkerSnapshotClient`, `ModelingService`, `SketchSolverService` or its adapter, and `DocumentRepository`. The wrappers measure elapsed time, classify results, and attach attributes that are already available at those boundaries.

Alternative considered: add telemetry inside every feature operation or solver helper. That provides more detail, but violates the user's constraint and would quickly become high-churn code.

### Decision: Sentry data uses tracing spans and span attributes

Use Sentry tracing spans and span attributes for custom performance data. Do not use the removed/deprecated Sentry metrics API or transaction measurements. Sampling should be configured centrally so high-frequency surfaces remain cheap.

Alternative considered: use a standalone metrics API abstraction with counters/gauges/distributions now. That adds backend assumptions and risks designing around APIs Sentry no longer supports in current JavaScript SDKs.

### Decision: Startup telemetry distinguishes readiness phases

Startup telemetry should distinguish renderer/canvas readiness, OCC warmup, first snapshot, and first non-empty geometry frame. The existing benchmark bridge can remain for local scripts, but production telemetry should not depend on browser globals as its primary contract.

Alternative considered: treat first snapshot as first draw. That keeps implementation small but hides the difference between "model data ready" and "geometry visibly rendered."

### Decision: Sketch drag telemetry is gesture-level aggregation

For drag interactions, record one span per drag gesture with aggregate attributes such as update count, accepted count, blocked count, max frame solve time, and total elapsed time. Per-pointer-move telemetry is excluded.

Alternative considered: emit one span per drag update. That would be discoverable in traces but too noisy and too expensive for pointer-rate interactions.

### Decision: Counts must be cheap and low-cardinality

Allowed attributes include operation kind, result status, diagnostic count, feature count, sketch count, sketch operation count, constraint count, dimension count, body count, render-record count, repository source, and repository head count. Do not derive expensive topology, mesh, Automerge, or solver internals just for telemetry.

Alternative considered: compute rich complexity metrics. Rich metrics may be useful in offline benchmarks, but production spans should not add work to the operations being measured.

## Risks / Trade-offs

- [Risk] Telemetry wrappers can accidentally change async semantics or error propagation. -> Mitigation: wrappers must preserve thrown errors, rejected promises, and result objects exactly, with tests covering no-op and throwing paths.
- [Risk] Sentry spans can become noisy or expensive. -> Mitigation: central sampling, gesture aggregation, and explicit exclusion of per-frame/per-iteration/per-topology spans.
- [Risk] Low-cardinality attributes may be less diagnostic than deep internal metrics. -> Mitigation: start with operation-level spans and use benchmark scripts for deep performance investigations.
- [Risk] First non-empty geometry frame can be awkward to detect without UI coupling. -> Mitigation: expose a narrow viewport readiness callback and test the signal at the viewport/workbench seam, not inside render internals.
- [Risk] Wrapping many construction sites still creates integration churn. -> Mitigation: start with OCC worker, sketch solver, modeling service, repository, and startup readiness only; do not chase every helper or controller.

## Migration Plan

1. Add the performance telemetry contract, no-op implementation, and Sentry tracing adapter.
2. Enable tracing configuration in Sentry initialization with conservative sampling and development opt-in behavior aligned with existing Sentry enablement.
3. Add instrumented wrapper constructors for OCC worker client, sketch solver service/adapter, modeling service, and document repository.
4. Route browser runtime composition through the wrappers while keeping tests and non-browser paths able to use no-op telemetry.
5. Replace or supplement the benchmark-only startup bridge with app-owned startup telemetry marks for warmup, first snapshot, canvas creation, and first non-empty geometry frame.
6. Add aggregate sketch drag telemetry at the gesture lifecycle seam only if the existing drag lifecycle exposes one clean integration point; otherwise leave drag telemetry out of the first implementation rather than instrumenting pointer moves.
7. Add focused tests for wrapper behavior, disabled no-op behavior, Sentry adapter attributes, and excluded expensive/high-cardinality attributes.
8. Keep benchmark scripts for exact local measurements and compare their output with the new production spans as a sanity check.

## Open Questions

- What production tracing sample rate should be used initially for CAD operation spans?
- Should local development tracing require the existing `cadEnableSentry=1` flag, a new `cadEnablePerfTelemetry=1` flag, or both?
- Should first non-empty geometry frame be included in the first implementation if it requires viewport component edits beyond a narrow callback?
