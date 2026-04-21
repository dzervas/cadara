# loft-feature Specification

## Purpose
TBD - created by archiving change add-loft-feature-slice. Update Purpose after archive.
## Requirements
### Requirement: Loft SHALL be available as a part-mode feature
The system SHALL expose loft as an authored part-mode feature through the existing tool registry and feature authoring registry.

#### Scenario: User activates loft
- **WHEN** the user activates the loft tool in part mode
- **THEN** the workbench starts a loft feature authoring session using the registered loft authoring definition

#### Scenario: User is in sketch mode
- **WHEN** the toolbar is rendering sketch-mode tools
- **THEN** loft is not exposed as an active sketch tool

### Requirement: Loft SHALL use ordered profile participants
The loft feature SHALL define its inputs through ordered advanced-solid `profile` participants rather than generic reference arrays or inferred section order.

#### Scenario: Loft declares required profiles
- **WHEN** the loft authoring definition is registered
- **THEN** it declares a required `profile` participant accepting two or more ordered durable profile targets

#### Scenario: Loft accepts a selected profile
- **WHEN** the user selects a derived sketch region or planar face for the loft profile role
- **THEN** the loft draft records that target as the next ordered `profile` participant without changing already selected section order

#### Scenario: Loft reorders profiles
- **WHEN** the user changes the order of selected loft profiles in the editor
- **THEN** the loft draft preserves the updated explicit section order for preview, commit, and edit hydration

### Requirement: Loft SHALL support optional guide-curve participants explicitly
The loft feature SHALL represent guide curves explicitly when they are authored, and SHALL not infer them from section geometry or hidden sketch state.

#### Scenario: Loft declares guide curves
- **WHEN** the loft authoring definition exposes guide-curve input
- **THEN** it declares `guideCurve` participants with accepted durable target kinds for that role

#### Scenario: Guide curve is not supported by the current implementation
- **WHEN** a contract-valid loft draft includes guide curves that the current implementation cannot build
- **THEN** validation or adapter execution returns a structured unsupported-case diagnostic rather than dropping the guide curves silently

### Requirement: Loft SHALL validate operation intent and target-body requirements
The loft feature SHALL declare supported operation intents and SHALL require explicit `targetBody` participants for non-create operations that it supports.

#### Scenario: Loft creates a standalone result
- **WHEN** the loft draft uses `create` operation intent with at least two valid ordered profiles
- **THEN** preview and commit construction do not require a target-body participant

#### Scenario: Loft uses a boolean operation
- **WHEN** the loft draft uses `add`, `subtract`, or `intersect` and the loft definition exposes that intent
- **THEN** preview and commit validation require at least one explicit `targetBody` participant

#### Scenario: Loft receives an unsupported operation intent
- **WHEN** a loft definition requests an operation intent that the loft definition does not support
- **THEN** validation returns a structured unsupported-operation diagnostic

### Requirement: Loft SHALL provide authoring diagnostics and preview readiness
The loft feature SHALL provide role-specific diagnostics and preview labels for missing profiles, invalid target kinds, invalid cardinality, invalid order-dependent state, and unsupported combinations.

#### Scenario: Loft has too few profiles
- **WHEN** preview is requested before two profile participants are selected
- **THEN** the editor reports a profile-specific missing-input diagnostic and does not commit a feature

#### Scenario: Loft target kind is invalid
- **WHEN** a selected durable target does not match the active loft participant role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than assigning the target to another role

#### Scenario: Loft preview is ready
- **WHEN** the loft draft has the minimum valid ordered profiles and any required additional participants for the selected operation intent
- **THEN** the editor reports preview readiness using a loft-specific preview label

### Requirement: Loft SHALL round-trip through modeling state
The loft feature SHALL preserve its ordered profile participants, guide-curve participants, operation intent, options, diagnostics, and feature identity through preview, commit, operation history, snapshots, and edit hydration.

#### Scenario: Loft is committed
- **WHEN** a valid loft feature is committed
- **THEN** the operation-history entry stores the loft feature definition with ordered `profile` participants and any committed operation intent or guide curves

#### Scenario: Loft is hydrated for editing
- **WHEN** the user edits an existing loft feature
- **THEN** the feature authoring draft is reconstructed from the committed loft participant roles and preserved profile order

#### Scenario: Loft appears in document views
- **WHEN** a loft feature has been committed
- **THEN** the document snapshot, feature timeline, object rows, and render bindings expose the committed loft result consistently with other feature kinds

### Requirement: Loft SHALL handle kernel support explicitly
The loft implementation SHALL either build supported loft geometry through the modeling adapter or return structured unsupported-case diagnostics for valid but unsupported loft definitions.

#### Scenario: Supported loft is previewed
- **WHEN** the modeling adapter receives a supported loft definition with valid ordered profiles
- **THEN** preview returns transient render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported loft is committed
- **WHEN** the modeling adapter receives a supported loft definition in a commit request
- **THEN** the committed document contains the loft feature and renderable result geometry

#### Scenario: Unsupported loft combination is requested
- **WHEN** the modeling adapter receives a contract-valid loft definition that the current kernel implementation cannot build
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping profiles, reordering sections, changing operation intent, or guessing alternate geometry

### Requirement: Loft SHALL include feature-slice test coverage
The loft implementation SHALL include tests at the contract, authoring, adapter, and e2e levels before the loft slice is considered complete.

#### Scenario: Loft unit and integration coverage runs
- **WHEN** the automated test suite runs
- **THEN** it covers loft validation, ordered-section draft selection, reordering behavior, draft-to-definition construction, operation-history persistence, snapshot hydration, and adapter-supported or adapter-unsupported behavior

#### Scenario: Loft e2e flow runs
- **WHEN** the Playwright feature-flow suite runs
- **THEN** it exercises loft tool activation, required ordered profile selection, preview or validation feedback, commit, and resulting document or geometry state in a flow comparable to the existing extrude and sweep feature e2e tests

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

