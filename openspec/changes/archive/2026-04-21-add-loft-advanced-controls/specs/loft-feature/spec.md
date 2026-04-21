## ADDED Requirements

### Requirement: Loft SHALL support an optional path participant
The loft feature SHALL represent path as an optional participant distinct from guide curves and SHALL scope path section count to the path option.

#### Scenario: Loft path is authored
- **WHEN** a loft definition includes a path participant
- **THEN** the definition preserves the path as a path role rather than a guide-curve role

#### Scenario: Path section count is omitted
- **WHEN** a loft definition includes a path without an authored section count
- **THEN** the feature uses a default section count of `5`

#### Scenario: Path section count is invalid
- **WHEN** a loft definition includes a path section count that does not resolve to a positive integer
- **THEN** validation rejects the feature before geometry execution

### Requirement: Loft SHALL preserve guide curves separately from path
The loft feature SHALL preserve optional guide curve participants separately from path and SHALL allow the contract to represent both guides and path on the same loft.

#### Scenario: Guides and path are authored together
- **WHEN** a loft definition contains both guide-curve participants and a path participant
- **THEN** the durable feature definition preserves both authored controls
- **AND** the modeling adapter decides whether the geometric combination is supported

#### Scenario: Guide curve is invalid
- **WHEN** a guide curve cannot be resolved or does not satisfy guide requirements for the selected profiles
- **THEN** preview or commit returns structured diagnostics without dropping the guide curve from the authored definition

### Requirement: Loft SHALL support profile and guide continuity controls
The loft feature SHALL represent start/end profile conditions and guide continuity controls explicitly.

#### Scenario: Profile condition is authored
- **WHEN** a loft definition includes a start or end profile condition
- **THEN** the condition is preserved with its condition kind and any expression-capable magnitude through preview, commit, history replay, and edit hydration

#### Scenario: Guide continuity is authored
- **WHEN** a loft guide includes continuity such as normal to guide, tangent to guide, match tangent, or match curvature
- **THEN** the continuity selection is preserved with the guide control and used by geometry execution when supported

### Requirement: Loft SHALL support match connections for twist control
The loft feature SHALL represent optional match connections that pair durable vertices or edges across selected profiles.

#### Scenario: Connection is authored
- **WHEN** a loft definition includes a match connection
- **THEN** the definition preserves the selected vertex or edge references and uses them to control loft alignment during execution

#### Scenario: Connection is incomplete
- **WHEN** a loft connection does not include one valid selection per required profile side
- **THEN** validation rejects the feature with a connection-specific diagnostic

### Requirement: Advanced loft controls SHALL execute through OCC
Advanced loft path, guide, continuity, and connection controls SHALL be implemented in the OpenCascade-backed modeling adapter for supported combinations.

#### Scenario: Path loft preview runs
- **WHEN** preview receives a valid loft with ordered profiles, path, and section count
- **THEN** the adapter returns transient geometry that follows the path according to the section count

#### Scenario: Guide loft commit runs
- **WHEN** commit receives a valid loft with ordered profiles and guide curves using no guide continuity
- **THEN** the adapter commits the loft feature and persisted snapshots hydrate the same guide controls for editing

#### Scenario: Guide-continuity loft runs
- **WHEN** preview or commit receives a valid loft with ordered profiles, guide curves, and a supported guide-continuity mode
- **THEN** the adapter returns geometry reflecting the requested guide continuity

#### Scenario: Profile condition loft runs
- **WHEN** preview or commit receives a valid loft with ordered profiles and supported start or end normal/tangent profile conditions
- **THEN** the adapter returns geometry reflecting the requested profile conditions

#### Scenario: Connection loft runs
- **WHEN** preview or commit receives a valid loft with two ordered profiles and one complete match connection between durable profile vertices or edges
- **THEN** the adapter uses the connection to align the loft rather than relying only on inferred vertex order

#### Scenario: Unsupported combination is encountered
- **WHEN** the adapter receives a contract-valid combination it cannot model
- **THEN** it returns a structured diagnostic and does not drop path, guide, continuity, or connection intent

### Requirement: Loft SHALL define a minimum supported advanced geometry matrix
The loft implementation SHALL treat path-only lofts, guide-only lofts without guide continuity, at least one guide-continuity mode, supported normal/tangent profile-condition lofts, and one-connection two-profile lofts as required geometry paths rather than optional unsupported cases.

#### Scenario: Minimum supported matrix is tested
- **WHEN** the OCC loft adapter test suite runs
- **THEN** it includes successful preview or commit coverage for path-only, guide-only without guide continuity, one guide-continuity mode, supported normal/tangent profile condition, and one-connection two-profile loft cases
