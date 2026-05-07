## ADDED Requirements

### Requirement: Document repository performance telemetry SHALL use repository operation seams
Document repository implementations SHALL record sampled performance spans for load, mutate, reset, undo, redo, and durable-history persistence operations at repository method boundaries.

#### Scenario: Repository mutation succeeds
- **WHEN** a document repository mutation completes successfully
- **THEN** performance telemetry records the repository operation span
- **AND** the span can include repository source, storage kind, asset availability count, and repository head count when those values are already present in repository metadata

#### Scenario: Repository operation fails
- **WHEN** a document repository operation returns a failed restore or mutation status
- **THEN** performance telemetry records the failure classification and diagnostic reason code when possible
- **AND** the repository result is returned unchanged to the caller

### Requirement: Repository telemetry SHALL NOT calculate full Automerge version history
Repository performance telemetry SHALL use cheap repository metadata such as current head count and source, and SHALL NOT traverse or calculate full Automerge version history solely for telemetry.

#### Scenario: Automerge metadata exposes heads
- **WHEN** repository metadata includes causal heads for the active document
- **THEN** performance telemetry can record the number of current heads
- **AND** it does not label that value as total version count

#### Scenario: Full version count is not already available
- **WHEN** the repository does not already expose a total Automerge version count at the measured seam
- **THEN** telemetry does not load or traverse Automerge history to calculate one
