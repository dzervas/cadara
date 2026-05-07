## 1. Telemetry Contract

- [x] 1.1 Add an app-owned performance telemetry interface, span attribute types, result classification helpers, and a no-op implementation.
- [x] 1.2 Add a Sentry-backed performance telemetry adapter that uses tracing spans and span attributes without using removed metrics APIs or deprecated transaction measurements.
- [x] 1.3 Wire conservative tracing enablement and sampling into existing Sentry initialization while preserving disabled/no-op behavior outside enabled environments.

## 2. Seam Wrappers

- [x] 2.1 Add an instrumented OCC worker client wrapper that records one span per worker operation kind and preserves success, failure, and rejection behavior.
- [x] 2.2 Add an instrumented modeling-service wrapper or factory option that records operation spans for snapshots, commits, feature mutations, previews, exports, and cheap document complexity counts.
- [x] 2.3 Add an instrumented sketch-solver service or adapter wrapper that records solve, validate, projection, region extraction, and explicit interactive-solve lifecycle spans at the solver boundary.
- [x] 2.4 Add an instrumented document repository wrapper that records load, mutate, reset, undo, redo, and durable-history operation spans with repository source and head count.

## 3. Startup And Drag Signals

- [x] 3.1 Replace or supplement the benchmark-only startup perf bridge with app-owned telemetry marks for canvas creation, OCC warmup settled, first snapshot ready, and first non-empty geometry frame.
- [x] 3.2 Add sketch drag gesture aggregation only if it can attach cleanly to the existing drag lifecycle; record one gesture span with aggregate update counts and timing, or leave drag telemetry out of the initial implementation rather than measuring pointer moves.

## 4. Composition

- [x] 4.1 Route browser runtime construction through the telemetry wrappers for OCC worker, modeling service, sketch solver, and document repository without changing domain contracts.
- [x] 4.2 Ensure tests, node paths, and disabled telemetry paths use the no-op implementation by default.
- [x] 4.3 Keep local benchmark scripts working and align any existing `__cadOccPerf` output with the new startup marks where practical.

## 5. Verification

- [x] 5.1 Add logic/static tests for no-op telemetry, Sentry adapter span attributes, wrapper result preservation, and error propagation.
- [x] 5.2 Add focused coverage for allowed low-cardinality attributes and excluded expensive/high-frequency metrics.
- [x] 5.3 Add UI or e2e coverage for first non-empty geometry frame readiness only if that signal cannot be validated through a smaller viewport/workbench seam test.
- [x] 5.4 Run `bun run test:all`.
- [x] 5.5 Run `openspec validate add-seam-performance-telemetry --strict`.
