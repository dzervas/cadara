# geometry-file-export Specification

## Purpose
Defines real kernel-backed STL, STEP, and 3MF export generation from exportable modeled bodies.

## Requirements
### Requirement: OCC body exports SHALL produce real geometry files
The OpenCascade export adapter SHALL generate real file payloads for supported geometry export formats from the selected live solid body.

#### Scenario: Export STL for a live body
- **WHEN** the user submits an STL export request for a live body target at the current revision
- **THEN** the export operation succeeds with a non-empty `.stl` payload
- **AND** the payload represents tessellated geometry from the selected body rather than a synthetic mock payload

#### Scenario: Export STEP for a live body
- **WHEN** the user submits a STEP export request for a live body target at the current revision
- **THEN** the export operation succeeds with a non-empty `.step` payload
- **AND** the payload represents B-Rep geometry from the selected body rather than a synthetic mock payload

#### Scenario: Export 3MF for a live body
- **WHEN** the user submits a 3MF export request for a live body target at the current revision
- **THEN** the export operation succeeds with a non-empty `.3mf` payload
- **AND** the payload is a valid 3MF package containing tessellated geometry from the selected body

### Requirement: Tessellated exports SHALL honor mesh accuracy options
STL and 3MF exports SHALL generate their mesh payloads using the request's mesh accuracy options.

#### Scenario: STL uses requested mesh accuracy
- **WHEN** the user submits an STL export request with mesh chord and angle tolerances
- **THEN** the OpenCascade adapter meshes the selected body using those requested tolerances before writing the STL payload

#### Scenario: 3MF uses requested mesh accuracy
- **WHEN** the user submits a 3MF export request with mesh chord and angle tolerances
- **THEN** the OpenCascade adapter meshes the selected body using those requested tolerances before writing the 3MF payload

#### Scenario: STEP does not use mesh accuracy
- **WHEN** the user submits a STEP export request
- **THEN** the OpenCascade adapter writes STEP B-Rep output without requiring mesh accuracy options

### Requirement: Geometry export metadata SHALL match the generated format
Successful geometry exports SHALL return metadata that matches the requested format and the payload being downloaded.

#### Scenario: STL metadata
- **WHEN** an STL export succeeds
- **THEN** the result format is `stl`
- **AND** the result filename ends with `.stl`
- **AND** the result MIME type is for STL content

#### Scenario: STEP metadata
- **WHEN** a STEP export succeeds
- **THEN** the result format is `step`
- **AND** the result filename ends with `.step`
- **AND** the result MIME type is for STEP content

#### Scenario: 3MF metadata
- **WHEN** a 3MF export succeeds
- **THEN** the result format is `3mf`
- **AND** the result filename ends with `.3mf`
- **AND** the result MIME type is for 3MF content

### Requirement: Unsupported geometry exports SHALL fail with diagnostics
The OpenCascade export adapter SHALL return a failure result with diagnostics instead of downloading invalid or placeholder geometry when the requested geometry export cannot be produced.

#### Scenario: Reject stale revision
- **WHEN** the user submits a geometry export request whose base revision does not match the current document revision
- **THEN** the export operation fails with a revision conflict diagnostic
- **AND** no payload is returned

#### Scenario: Reject missing body target
- **WHEN** the user submits a geometry export request for a body target that does not resolve in the current OpenCascade authoring state
- **THEN** the export operation fails with a missing or unexportable body diagnostic
- **AND** no payload is returned

#### Scenario: Reject non-body target
- **WHEN** the user submits a geometry export request for a target that is not a body
- **THEN** the export operation fails with an unexportable target diagnostic
- **AND** no payload is returned

#### Scenario: Reject unavailable writer
- **WHEN** the OpenCascade runtime cannot support the requested format writer
- **THEN** the export operation fails with a writer-unavailable diagnostic that names the requested format
- **AND** no placeholder payload is returned
