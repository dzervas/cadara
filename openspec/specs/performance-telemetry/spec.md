# performance-telemetry Specification

## Purpose
TBD - created by archiving change add-seam-performance-telemetry. Update Purpose after archive.
## Requirements
### Requirement: Performance telemetry SHALL be exposed through an app-owned boundary
The system SHALL expose a performance telemetry boundary that can start and finish timing spans without requiring domain, solver, modeling, persistence, or viewport modules to import Sentry directly.

#### Scenario: Telemetry is disabled
- **WHEN** performance telemetry is disabled or no telemetry client is configured
- **THEN** callers can create spans through the app-owned boundary without throwing
- **AND** the wrapped operation result, thrown error, or rejected promise is preserved exactly

#### Scenario: Telemetry is enabled
- **WHEN** performance telemetry is enabled and a telemetry client is configured
- **THEN** seam wrappers record spans through the app-owned boundary
- **AND** domain and application modules outside the Sentry adapter do not call Sentry APIs directly

### Requirement: Performance telemetry SHALL use low-cardinality seam attributes
The system SHALL attach only cheap, low-cardinality attributes that are available at the measured seam without additional topology traversal, mesh inspection, solver iteration inspection, or repository history traversal.

#### Scenario: Operation span records cheap context
- **WHEN** a measured seam completes
- **THEN** the emitted span can include operation kind, result classification, elapsed duration, diagnostic count, feature count, sketch count, sketch operation count, constraint count, dimension count, body count, render-record count, repository source, and repository head count when those values are already available at the seam

#### Scenario: Expensive context is not calculated
- **WHEN** a measured seam does not already have topology graph counts, mesh triangle totals, per-face counts, per-edge counts, full Automerge version counts, solver iteration counts, or full serialized document byte size
- **THEN** telemetry does not calculate those values solely for span attributes

### Requirement: Sentry-backed performance telemetry SHALL use tracing spans
The Sentry-backed telemetry implementation SHALL record performance data using Sentry tracing spans and span attributes rather than removed or deprecated JavaScript metrics APIs.

#### Scenario: Sentry tracing records a seam span
- **WHEN** a sampled seam operation is measured by the Sentry-backed telemetry implementation
- **THEN** the operation is represented as a Sentry span with stable operation/name fields and low-cardinality attributes

#### Scenario: Legacy metrics APIs are unavailable
- **WHEN** the current Sentry JavaScript SDK does not expose the removed metrics API or when transaction measurements are deprecated
- **THEN** performance telemetry continues to use tracing spans and does not depend on those APIs

### Requirement: Performance telemetry SHALL avoid high-frequency span spam
The system SHALL avoid emitting telemetry at pointer-move, render-frame, solver-iteration, OCC-subshape, or per-mesh-buffer frequency.

#### Scenario: Sketch point drag is measured
- **WHEN** a constrained sketch drag gesture is measured
- **THEN** telemetry emits at most one gesture-level span for that drag
- **AND** the span can include aggregate counts and timing summaries for the gesture

#### Scenario: Repeated low-level work happens inside a measured operation
- **WHEN** a kernel operation, solver operation, or render operation performs many internal iterations or subshape visits
- **THEN** telemetry records the outer seam operation only
- **AND** it does not emit spans for each internal iteration, subshape, pointer move, or frame

### Requirement: Performance telemetry SHALL preserve error behavior
Performance telemetry wrappers SHALL record failed spans without swallowing, replacing, or reclassifying exceptions and contract-level errors.

#### Scenario: Wrapped operation throws
- **WHEN** a wrapped operation throws or rejects
- **THEN** telemetry marks the span as failed when possible
- **AND** the same error continues through the existing application error path

#### Scenario: Wrapped operation returns a domain rejection
- **WHEN** a wrapped modeling, solver, or repository operation returns a contract-level rejected or conflict result
- **THEN** telemetry can mark the result classification on the span
- **AND** the operation result remains unchanged for the caller

