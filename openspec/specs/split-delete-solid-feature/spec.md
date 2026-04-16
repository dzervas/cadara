# split-delete-solid-feature Specification

## Purpose
TBD - created by archiving change add-split-delete-solid-feature-slice. Update Purpose after archive.
## Requirements
### Requirement: Split and delete-solid SHALL be available as part-mode features
The system SHALL expose split and delete-solid as authored part-mode features through the existing tool registry and feature authoring registry.

#### Scenario: User activates split
- **WHEN** the user activates the split tool in part mode
- **THEN** the workbench starts a split feature authoring session using the registered split authoring definition

#### Scenario: User activates delete-solid
- **WHEN** the user activates the delete-solid tool in part mode
- **THEN** the workbench starts a delete-solid feature authoring session using the registered delete-solid authoring definition

### Requirement: Split SHALL use explicit body and split-tool participants
The split feature SHALL define its inputs through explicit advanced-solid participants rather than inferred body context or hidden split-tool rules.

#### Scenario: Split declares required participants
- **WHEN** the split authoring definition is registered
- **THEN** it declares at least one required `targetBody` participant and one required supported split-tool participant such as `plane` or `toolBody`

#### Scenario: Split accepts a selected participant
- **WHEN** the user selects an accepted durable target for the active split participant role
- **THEN** the split draft records that target under the correct role without overwriting unrelated participant roles

#### Scenario: Split rejects an invalid participant
- **WHEN** the user selects a durable target that does not match the active split participant role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than coercing that target into another role

### Requirement: Delete-solid SHALL use explicit body participants
The delete-solid feature SHALL identify the bodies to remove through explicit advanced-solid `body` participants.

#### Scenario: Delete-solid declares required body targets
- **WHEN** the delete-solid authoring definition is registered
- **THEN** it declares a required `body` participant accepting one or more durable body targets

#### Scenario: Delete-solid accepts a selected body
- **WHEN** the user selects a durable body target while authoring delete-solid
- **THEN** the delete-solid draft records that target as a `body` participant without inferring additional bodies

### Requirement: Split and delete-solid SHALL round-trip through modeling state
Split and delete-solid SHALL preserve their participants, options, diagnostics, and feature identity through preview, commit, operation history, snapshots, and edit hydration.

#### Scenario: Split is committed
- **WHEN** a valid split feature is committed
- **THEN** the operation-history entry stores the split feature definition with its committed target bodies and split tool

#### Scenario: Delete-solid is committed
- **WHEN** a valid delete-solid feature is committed
- **THEN** the operation-history entry stores the delete-solid feature definition with its committed body targets

#### Scenario: Split or delete-solid is hydrated for editing
- **WHEN** the user edits an existing split or delete-solid feature
- **THEN** the feature authoring draft is reconstructed from the committed participants and preserved options for that feature

### Requirement: Split and delete-solid SHALL handle kernel support explicitly
Split and delete-solid SHALL either build supported geometry changes through the modeling adapter or return structured unsupported-case diagnostics for valid but unsupported definitions.

#### Scenario: Supported split is previewed
- **WHEN** the modeling adapter receives a supported split definition with valid target-body and split-tool participants
- **THEN** preview returns transient render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported delete-solid is committed
- **WHEN** the modeling adapter receives a supported delete-solid definition in a commit request
- **THEN** the committed document removes the targeted body or bodies and updates document views consistently

#### Scenario: Unsupported split or delete-solid combination is requested
- **WHEN** the modeling adapter receives a contract-valid split or delete-solid definition that the current kernel implementation cannot build or apply
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping participants, deleting extra bodies, or guessing alternate geometry

### Requirement: Split and delete-solid SHALL include feature-slice test coverage
The split/delete-solid implementation SHALL include tests at the contract, authoring, adapter, and e2e levels before the slice is considered complete.

#### Scenario: Split/delete-solid unit and integration coverage runs
- **WHEN** the automated test suite runs
- **THEN** it covers split/delete-solid validation, draft selection, draft-to-definition construction, operation-history persistence, snapshot hydration, invalid-reference effects, and adapter-supported or adapter-unsupported behavior

#### Scenario: Split/delete-solid e2e flow runs
- **WHEN** the Playwright feature-flow suite runs
- **THEN** it exercises split and delete-solid user-facing flows through tool activation, required participant selection, preview or validation feedback, commit, and resulting document or body state in flows comparable to the existing feature e2e tests

