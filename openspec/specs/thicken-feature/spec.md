# thicken-feature Specification

## Purpose
TBD - created by archiving change add-thicken-feature-slice. Update Purpose after archive.
## Requirements
### Requirement: Thicken SHALL be available as a part-mode feature
The system SHALL expose thicken as an authored part-mode feature through the existing tool registry and feature authoring registry.

#### Scenario: User activates thicken
- **WHEN** the user activates the thicken tool in part mode
- **THEN** the workbench starts a thicken feature authoring session using the registered thicken authoring definition

#### Scenario: User is in sketch mode
- **WHEN** the toolbar is rendering sketch-mode tools
- **THEN** thicken is not exposed as an active sketch tool

### Requirement: Thicken SHALL use explicit topology participants
The thicken feature SHALL define its inputs through explicit advanced-solid participants rather than inferred topology or viewport order.

#### Scenario: Thicken declares required targets
- **WHEN** the thicken authoring definition is registered
- **THEN** it declares at least one required topology participant such as `face` with accepted durable target kinds for that role

#### Scenario: Thicken accepts a selected target
- **WHEN** the user selects an accepted durable target for the active thicken participant role
- **THEN** the thicken draft records that target for preview and commit without changing unrelated participant roles

#### Scenario: Thicken rejects an invalid target
- **WHEN** the user selects a durable target that does not match the active thicken participant role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than coercing that target into another role

### Requirement: Thicken SHALL validate thickness options and operation intent
The thicken feature SHALL validate positive thickness options and SHALL require explicit target-body participants for any non-create operation intents that it supports.

#### Scenario: Thicken has a valid thickness
- **WHEN** the thicken draft has the required target participants and a positive thickness value
- **THEN** preview and commit construction can build a thicken definition

#### Scenario: Thicken has an invalid thickness
- **WHEN** the thicken draft has a missing, zero, negative, or non-finite thickness value
- **THEN** the editor reports a thickness-specific diagnostic and does not commit a feature

#### Scenario: Thicken uses a boolean operation
- **WHEN** the thicken draft uses a supported non-create operation intent
- **THEN** preview and commit validation require at least one explicit `targetBody` participant

### Requirement: Thicken SHALL round-trip through modeling state
The thicken feature SHALL preserve its participants, thickness options, operation intent, diagnostics, and feature identity through preview, commit, operation history, snapshots, and edit hydration.

#### Scenario: Thicken is committed
- **WHEN** a valid thicken feature is committed
- **THEN** the operation-history entry stores the thicken feature definition with the committed participants and thickness options

#### Scenario: Thicken is hydrated for editing
- **WHEN** the user edits an existing thicken feature
- **THEN** the feature authoring draft is reconstructed from the committed thicken participants, options, and operation intent

#### Scenario: Thicken appears in document views
- **WHEN** a thicken feature has been committed
- **THEN** the document snapshot, feature timeline, object rows, and render bindings expose the committed thicken result consistently with other feature kinds

### Requirement: Thicken SHALL handle kernel support explicitly
The thicken implementation SHALL either build supported thicken geometry through the modeling adapter or return structured unsupported-case diagnostics for valid but unsupported thicken definitions.

#### Scenario: Supported thicken is previewed
- **WHEN** the modeling adapter receives a supported thicken definition with valid participants and options
- **THEN** preview returns transient render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported thicken is committed
- **WHEN** the modeling adapter receives a supported thicken definition in a commit request
- **THEN** the committed document contains the thicken feature and renderable result geometry

#### Scenario: Unsupported thicken combination is requested
- **WHEN** the modeling adapter receives a contract-valid thicken definition that the current kernel implementation cannot build
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping participants, changing options, or guessing alternate geometry

### Requirement: Thicken SHALL include feature-slice test coverage
The thicken implementation SHALL include tests at the contract, authoring, adapter, and e2e levels before the thicken slice is considered complete.

#### Scenario: Thicken unit and integration coverage runs
- **WHEN** the automated test suite runs
- **THEN** it covers thicken validation, draft selection, option validation, draft-to-definition construction, operation-history persistence, snapshot hydration, and adapter-supported or adapter-unsupported behavior

#### Scenario: Thicken e2e flow runs
- **WHEN** the Playwright feature-flow suite runs
- **THEN** it exercises thicken tool activation, required target selection, thickness entry, preview or validation feedback, commit, and resulting document or geometry state in a flow comparable to the existing extrude and other feature e2e tests

