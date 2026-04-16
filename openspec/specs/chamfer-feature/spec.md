# chamfer-feature Specification

## Purpose
TBD - created by archiving change add-chamfer-feature-slice. Update Purpose after archive.
## Requirements
### Requirement: Chamfer SHALL be available as a part-mode feature
The system SHALL expose chamfer as an authored part-mode feature through the existing tool registry and feature authoring registry.

#### Scenario: User activates chamfer
- **WHEN** the user activates the chamfer tool in part mode
- **THEN** the workbench starts a chamfer feature authoring session using the registered chamfer authoring definition

#### Scenario: User is in sketch mode
- **WHEN** the toolbar is rendering sketch-mode tools
- **THEN** chamfer is not exposed as an active sketch tool

### Requirement: Chamfer SHALL use durable edge participants
The chamfer feature SHALL define its topology targets through explicit advanced-solid `edge` participants rather than inferred faces, body order, or viewport order.

#### Scenario: Chamfer declares edge participants
- **WHEN** the chamfer authoring definition is registered
- **THEN** it declares a required `edge` participant accepting one or more durable edge targets

#### Scenario: Chamfer accepts an edge target
- **WHEN** the user selects a durable edge target while authoring chamfer
- **THEN** the chamfer draft records that target as an `edge` participant without overwriting previously selected unique edge targets

#### Scenario: Chamfer rejects a non-edge target
- **WHEN** the user selects a durable target that is not accepted for the chamfer edge role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than converting the target into an edge selection

### Requirement: Chamfer SHALL support a constant-distance first slice
The chamfer feature SHALL support an initial constant-distance chamfer parameter and SHALL reject invalid distance values before commit.

#### Scenario: Chamfer distance is valid
- **WHEN** the chamfer draft has at least one edge target and a positive distance value
- **THEN** preview and commit construction can build a chamfer definition using that distance

#### Scenario: Chamfer distance is invalid
- **WHEN** the chamfer draft has a missing, zero, negative, or non-finite distance value
- **THEN** the editor reports a distance-specific diagnostic and does not commit a feature

### Requirement: Chamfer SHALL provide authoring diagnostics and preview readiness
The chamfer feature SHALL provide role-specific diagnostics and preview labels for missing edge targets, invalid target kinds, invalid cardinality, invalid distance, and unsupported combinations.

#### Scenario: Chamfer edge target is missing
- **WHEN** preview is requested before any edge participant is selected
- **THEN** the editor reports an edge-specific missing-input diagnostic and does not commit a feature

#### Scenario: Chamfer preview is ready
- **WHEN** the chamfer draft has at least one valid edge target and a positive distance
- **THEN** the editor reports preview readiness using a chamfer-specific preview label

### Requirement: Chamfer SHALL round-trip through modeling state
The chamfer feature SHALL preserve its edge participants, distance parameter, diagnostics, and feature identity through preview, commit, operation history, snapshots, and edit hydration.

#### Scenario: Chamfer is committed
- **WHEN** a valid chamfer feature is committed
- **THEN** the operation-history entry stores the chamfer feature definition with role-specific `edge` participants and the selected distance parameter

#### Scenario: Chamfer is hydrated for editing
- **WHEN** the user edits an existing chamfer feature
- **THEN** the feature authoring draft is reconstructed from the committed chamfer edge participants and distance parameter

#### Scenario: Chamfer appears in document views
- **WHEN** a chamfer feature has been committed
- **THEN** the document snapshot, feature timeline, object rows, and render bindings expose the committed chamfer result consistently with other feature kinds

### Requirement: Chamfer SHALL handle kernel support explicitly
The chamfer implementation SHALL either build supported chamfer geometry through the modeling adapter or return structured unsupported-case diagnostics for valid but unsupported chamfer definitions.

#### Scenario: Supported chamfer is previewed
- **WHEN** the modeling adapter receives a supported chamfer definition with valid edge participants and distance
- **THEN** preview returns transient render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported chamfer is committed
- **WHEN** the modeling adapter receives a supported chamfer definition in a commit request
- **THEN** the committed document contains the chamfer feature and renderable result geometry

#### Scenario: Unsupported chamfer combination is requested
- **WHEN** the modeling adapter receives a contract-valid chamfer definition that the current kernel implementation cannot build
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping edges, changing the distance, or guessing alternate geometry

### Requirement: Chamfer SHALL include feature-slice test coverage
The chamfer implementation SHALL include tests at the contract, authoring, adapter, and e2e levels before the chamfer slice is considered complete.

#### Scenario: Chamfer unit and integration coverage runs
- **WHEN** the automated test suite runs
- **THEN** it covers chamfer validation, draft selection, draft-to-definition construction, operation-history persistence, snapshot hydration, and adapter-supported or adapter-unsupported behavior

#### Scenario: Chamfer e2e flow runs
- **WHEN** the Playwright feature-flow suite runs
- **THEN** it exercises chamfer tool activation, required edge selection, distance entry, preview or validation feedback, commit, and resulting document or geometry state in a flow comparable to the existing extrude and fillet feature e2e tests

