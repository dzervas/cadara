## ADDED Requirements

### Requirement: Sketch solver performance telemetry SHALL be captured at solver service seams
The sketch solver SHALL record sampled performance spans at solver service operations without embedding telemetry in residual evaluation, numeric iteration loops, region traversal internals, or sketch editor presentation code.

#### Scenario: Full solve is requested
- **WHEN** a caller requests sketch solving through the solver service boundary
- **THEN** performance telemetry records one solve span
- **AND** the span can include cheap counts such as point count, entity count, constraint count, dimension count, projected-reference count, diagnostic count, solve state, and constraint state

#### Scenario: Region extraction is requested
- **WHEN** a caller requests region extraction through the solver service boundary or as an explicit solve option
- **THEN** performance telemetry records the region-extraction operation at that boundary
- **AND** the span does not calculate expensive geometric summaries beyond counts already returned by region extraction

#### Scenario: Solver internals iterate
- **WHEN** the solver evaluates many residuals, gradients, or numeric iterations during a solve
- **THEN** performance telemetry does not emit per-residual, per-gradient, per-iteration, or per-constraint-term spans

### Requirement: Sketch drag telemetry SHALL be gesture-level
Constrained sketch drag performance telemetry SHALL be aggregated at the drag gesture lifecycle rather than emitted per pointer move.

#### Scenario: Drag gesture completes
- **WHEN** a constrained sketch drag starts, receives one or more updates, and ends or cancels
- **THEN** performance telemetry emits at most one drag gesture span
- **AND** the span can include aggregate update count, accepted update count, blocked update count, total elapsed time, and maximum observed update duration when those values are available at the gesture seam

#### Scenario: Drag updates occur at pointer frequency
- **WHEN** a drag gesture receives many pointer-rate updates
- **THEN** performance telemetry does not emit one span per update
