## Why

CADara needs production-quality performance visibility for the OCC kernel, sketch solver, document snapshots, and startup render path without scattering Sentry calls through modeling, solver, viewport, and persistence internals. The current benchmark-only `__cadOccPerf` bridge is useful for local startup probes, but it is not a durable telemetry contract and does not cover the live CAD operation seams.

## What Changes

- Add a seam-based performance telemetry capability that records sampled timing spans and low-cardinality attributes at existing architecture boundaries.
- Add a Sentry-backed implementation that uses tracing spans and span attributes rather than the removed/deprecated Sentry metrics APIs.
- Instrument only wrapper-level seams: OCC worker operations, modeling-service operations, sketch-solver service operations, document repository operations, and startup viewport readiness signals.
- Add aggregate sketch-drag telemetry only at the gesture seam; do not emit one telemetry item per pointer move.
- Record cheap context counts that already exist at the seam, such as feature count, sketch count, operation count, body count, render-record count, diagnostic count, repository head count, and operation kind.
- Exclude metrics that require invasive edits, expensive derived geometry analysis, full Automerge history traversal, mesh inspection, topology graph walking, per-feature internal timers, or per-solver-iteration instrumentation.
- Keep telemetry disabled/no-op when Sentry tracing is unavailable or not enabled.

## Capabilities

### New Capabilities

- `performance-telemetry`: Defines the seam-based performance telemetry contract, allowed measurement surfaces, low-cardinality attributes, Sentry tracing behavior, and explicit exclusions for expensive or invasive metrics.

### Modified Capabilities

- `occ-initial-render-latency`: Replace the benchmark-only startup readiness signal with a requirement for production telemetry to distinguish canvas creation, kernel warmup, first snapshot, and first non-empty geometry frame.
- `occ-kernel-adapter`: Require kernel-facing performance spans to be captured at the worker/client operation boundary rather than inside individual OCC feature functions.
- `sketch-constraint-solver`: Require solver performance spans to be captured at the solver service boundary, including full solve, region extraction, and aggregate interactive drag gesture timing.
- `document-repository`: Require repository persistence telemetry at load/mutate/undo/redo boundaries using repository metadata such as head count, without calculating full Automerge version counts.

## Impact

- Affected code: telemetry contracts/adapters, Sentry initialization options, browser runtime composition, OCC worker client construction, modeling-service construction, sketch-solver service construction, document repository construction, and viewport readiness lifecycle.
- Affected systems: Sentry performance tracing, OCC startup benchmarks, sketch solver benchmarks, document persistence, and workbench startup/render orchestration.
- Dependency impact: uses the existing `@sentry/browser` package; no new telemetry vendor or metrics SDK is required.
- Testing impact: add behavior-first logic/static coverage for no-op telemetry, Sentry adapter calls, wrapper attribution, and excluded high-cardinality/expensive attributes. Browser/e2e coverage is only needed for first non-empty geometry frame readiness if the seam cannot be validated in UI-lane component tests.
