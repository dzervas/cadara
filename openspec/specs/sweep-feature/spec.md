# sweep-feature Specification

## Purpose
TBD - created by archiving change add-sweep-feature-slice. Update Purpose after archive.
## Requirements
### Requirement: Sweep SHALL be available as a part-mode feature
The system SHALL expose sweep as an authored part-mode feature through the existing tool registry and feature authoring registry.

#### Scenario: User activates sweep
- **WHEN** the user activates the sweep tool in part mode
- **THEN** the workbench starts a sweep feature authoring session using the registered sweep authoring definition

#### Scenario: User is in sketch mode
- **WHEN** the toolbar is rendering sketch-mode tools
- **THEN** sweep is not exposed as an active sketch tool

### Requirement: Sweep SHALL use role-specific profile and path participants
The sweep feature SHALL define its inputs through advanced-solid participant roles rather than generic reference arrays.

#### Scenario: Sweep declares required participants
- **WHEN** the sweep authoring definition is registered
- **THEN** it declares at least one required `profile` participant and one required `path` participant with accepted durable target kinds for each role

#### Scenario: Sweep accepts a selected profile
- **WHEN** the user selects a derived sketch region or planar face for the sweep profile role
- **THEN** the sweep draft records that target as a `profile` participant without changing the path participant

#### Scenario: Sweep accepts a selected path
- **WHEN** the user selects an accepted durable path target for the sweep path role
- **THEN** the sweep draft records that target as a `path` participant without changing the profile participant

### Requirement: Sweep SHALL validate operation intent and boolean participants
The sweep feature SHALL declare supported operation intents and SHALL require explicit target-body participants for non-create operations.

#### Scenario: Sweep creates a standalone result
- **WHEN** the sweep draft uses `create` operation intent with valid profile and path participants
- **THEN** preview and commit construction do not require a target-body participant

#### Scenario: Sweep uses a boolean operation
- **WHEN** the sweep draft uses `add`, `subtract`, or `intersect` operation intent
- **THEN** preview and commit validation require at least one explicit `targetBody` participant

#### Scenario: Sweep receives an unsupported operation intent
- **WHEN** a sweep definition requests an operation intent that the sweep definition does not support
- **THEN** validation returns a structured unsupported-operation diagnostic

### Requirement: Sweep SHALL provide authoring diagnostics and preview readiness
The sweep feature SHALL provide role-specific diagnostics and preview labels for missing participants, invalid target kinds, invalid cardinality, and unsupported combinations.

#### Scenario: Sweep profile is missing
- **WHEN** preview is requested before any profile participant is selected
- **THEN** the editor reports a profile-specific missing-input diagnostic and does not commit a feature

#### Scenario: Sweep path is missing
- **WHEN** preview is requested before any path participant is selected
- **THEN** the editor reports a path-specific missing-input diagnostic and does not commit a feature

#### Scenario: Sweep target kind is invalid
- **WHEN** a selected durable target does not match the active sweep participant role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than assigning the target to another role

### Requirement: Sweep SHALL round-trip through modeling state
The sweep feature SHALL preserve its participant roles, operation intent, options, diagnostics, and feature identity through preview, commit, operation history, snapshots, and edit hydration.

#### Scenario: Sweep is committed
- **WHEN** a valid sweep feature is committed
- **THEN** the operation-history entry stores the sweep feature definition with role-specific `profile` and `path` participants and the selected operation intent

#### Scenario: Sweep is hydrated for editing
- **WHEN** the user edits an existing sweep feature
- **THEN** the feature authoring draft is reconstructed from the committed sweep participant roles and operation intent

#### Scenario: Sweep appears in document views
- **WHEN** a sweep feature has been committed
- **THEN** the document snapshot, feature timeline, object rows, and render bindings expose the committed sweep result consistently with other feature kinds

### Requirement: Sweep SHALL handle kernel support explicitly
The sweep implementation SHALL either build supported sweep geometry through the modeling adapter or return structured unsupported-case diagnostics for valid but unsupported sweep definitions.

#### Scenario: Supported sweep is previewed
- **WHEN** the modeling adapter receives a supported sweep definition with valid profile and path participants
- **THEN** preview returns transient render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported sweep is committed
- **WHEN** the modeling adapter receives a supported sweep definition in a commit request
- **THEN** the committed document contains the sweep feature and renderable result geometry

#### Scenario: Unsupported sweep combination is requested
- **WHEN** the modeling adapter receives a contract-valid sweep definition that the current kernel implementation cannot build
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping participants, changing operation intent, or guessing alternate geometry

### Requirement: Sweep SHALL include feature-slice test coverage
The sweep implementation SHALL include tests at the contract, authoring, adapter, and e2e levels before the sweep slice is considered complete.

#### Scenario: Sweep unit and integration coverage runs
- **WHEN** the automated test suite runs
- **THEN** it covers sweep validation, draft selection, draft-to-definition construction, operation-history persistence, snapshot hydration, and adapter-supported or adapter-unsupported behavior

#### Scenario: Sweep e2e flow runs
- **WHEN** the Playwright feature-flow suite runs
- **THEN** it exercises sweep tool activation, required profile and path selection, preview or validation feedback, commit, and resulting document or geometry state in a flow comparable to the existing extrude feature e2e test

