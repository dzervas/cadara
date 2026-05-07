## ADDED Requirements

### Requirement: OCC performance telemetry SHALL be captured at the worker operation boundary
The browser OCC runtime SHALL record sampled performance spans for kernel-facing operations at the OCC worker/client operation boundary rather than inside individual OCC feature functions, topology helpers, or mesh builders.

#### Scenario: Worker operation completes successfully
- **WHEN** the main thread invokes an OCC worker operation such as warmup, snapshot, sketch commit, feature mutation, preview evaluation, native topology payload building, or export payload building
- **THEN** performance telemetry records one span for the worker operation
- **AND** the span identifies the operation kind with low-cardinality attributes

#### Scenario: Worker operation fails
- **WHEN** an OCC worker operation returns a structured failure or rejects
- **THEN** performance telemetry records the failed operation classification when possible
- **AND** the original worker failure continues through the existing modeling or application error path

#### Scenario: Kernel internals perform repeated work
- **WHEN** an OCC worker operation internally visits many shapes, builds many mesh buffers, or performs multiple native calls
- **THEN** performance telemetry does not emit per-shape, per-buffer, per-face, per-edge, or per-native-call spans
