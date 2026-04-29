# geometry-file-export Specification

## Purpose
Defines real kernel-backed STL, STEP, and 3MF export generation from exportable modeled bodies.
## Requirements
### Requirement: OCC body exports SHALL produce real geometry files
Each geometry export provider SHALL generate real file payloads for its format from the selected live solid body, using services from `ExportCapabilities` rather than direct kernel adapter access.

#### Scenario: Export STL for a live body
- **WHEN** the STL export provider receives an export request for a live body target
- **THEN** it uses the tessellation capability to mesh the body
- **AND** produces a non-empty `.stl` payload representing tessellated geometry

#### Scenario: Export STEP for a live body
- **WHEN** the STEP export provider receives an export request for a live body target
- **THEN** it uses the B-Rep writer capability to serialize the body
- **AND** produces a non-empty `.step` payload representing B-Rep geometry

#### Scenario: Export 3MF for a live body
- **WHEN** the 3MF export provider receives an export request for a live body target
- **THEN** it uses the tessellation capability to mesh the body
- **AND** produces a non-empty `.3mf` package containing tessellated geometry

### Requirement: Tessellated exports SHALL honor mesh accuracy options
STL and 3MF export providers SHALL generate their mesh payloads using the options passed through the provider interface.

#### Scenario: STL uses requested mesh accuracy
- **WHEN** the STL export provider receives an export request with mesh chord and angle tolerances
- **THEN** it passes those tolerances to the tessellation capability before writing the STL payload

#### Scenario: 3MF uses requested mesh accuracy
- **WHEN** the 3MF export provider receives an export request with mesh chord and angle tolerances
- **THEN** it passes those tolerances to the tessellation capability before writing the 3MF payload

#### Scenario: STEP does not use mesh accuracy
- **WHEN** the STEP export provider receives an export request
- **THEN** it writes STEP B-Rep output without requiring mesh accuracy options

### Requirement: Unsupported geometry exports SHALL fail with diagnostics
Export providers SHALL return a failure result with diagnostics instead of producing invalid geometry when the export cannot be completed.

#### Scenario: Reject missing body target
- **WHEN** an export provider receives a request for a body that does not exist in the current state
- **THEN** the provider returns a failure result with a missing body diagnostic

#### Scenario: Reject non-body target
- **WHEN** an export provider receives a request for a target that is not a body
- **THEN** the provider returns a failure result with an unexportable target diagnostic

#### Scenario: Reject unavailable writer
- **WHEN** the capabilities bag cannot provide the required writer or tessellation service for a format
- **THEN** the provider returns a failure result with an unavailable capability diagnostic

