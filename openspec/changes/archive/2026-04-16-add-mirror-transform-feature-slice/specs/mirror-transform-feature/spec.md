## ADDED Requirements

### Requirement: Mirror and transform SHALL be available as part-mode features
The system SHALL expose mirror and transform as authored part-mode features through the existing tool registry and feature authoring registry.

#### Scenario: User activates mirror
- **WHEN** the user activates the mirror tool in part mode
- **THEN** the workbench starts a mirror feature authoring session using the registered mirror authoring definition

#### Scenario: User activates transform
- **WHEN** the user activates the transform tool in part mode
- **THEN** the workbench starts a transform feature authoring session using the registered transform authoring definition

### Requirement: Mirror and transform SHALL be body-only in the first slice
The first mirror/transform slice SHALL apply to explicit durable body targets rather than to sketches, constructions, or existing timeline features.

#### Scenario: Mirror declares body targets
- **WHEN** the mirror authoring definition is registered
- **THEN** it declares a required `body` participant and one explicit mirror reference participant such as `plane`

#### Scenario: Transform declares body targets
- **WHEN** the transform authoring definition is registered
- **THEN** it declares a required `body` participant and any required transform reference participants for the supported first-slice transform mode

#### Scenario: Non-body target is selected
- **WHEN** the user selects a durable target that is not accepted for the active mirror/transform participant role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than coercing that target into a body transform

### Requirement: Mirror and transform SHALL use explicit reference frames and options
Mirror and transform SHALL preserve explicit transform references and typed options rather than inferring frames from hidden application state.

#### Scenario: Mirror uses an explicit reference
- **WHEN** the user authors a mirror feature
- **THEN** the committed definition preserves the explicit mirror reference used to define the operation

#### Scenario: Transform uses explicit options
- **WHEN** the user authors a transform feature
- **THEN** the committed definition preserves the explicit typed transform options and any required transform reference used by the supported mode

### Requirement: Mirror and transform SHALL round-trip through modeling state
Mirror and transform SHALL preserve their participants, options, diagnostics, and feature identity through preview, commit, operation history, snapshots, and edit hydration.

#### Scenario: Mirror or transform is committed
- **WHEN** a valid mirror or transform feature is committed
- **THEN** the operation-history entry stores the feature definition with its committed body targets, references, and options

#### Scenario: Mirror or transform is hydrated for editing
- **WHEN** the user edits an existing mirror or transform feature
- **THEN** the feature authoring draft is reconstructed from the committed participants, references, and options for that feature

#### Scenario: Mirror or transform appears in document views
- **WHEN** a mirror or transform feature has been committed
- **THEN** the document snapshot, feature timeline, object rows, and render bindings expose the committed result consistently with other feature kinds

### Requirement: Mirror and transform SHALL handle kernel support explicitly
Mirror and transform SHALL either build supported geometry changes through the modeling adapter or return structured unsupported-case diagnostics for valid but unsupported definitions.

#### Scenario: Supported mirror or transform is previewed
- **WHEN** the modeling adapter receives a supported mirror or transform definition with valid participants, references, and options
- **THEN** preview returns transient render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported mirror or transform is committed
- **WHEN** the modeling adapter receives a supported mirror or transform definition in a commit request
- **THEN** the committed document contains the mirror or transform feature and renderable result geometry or body state

#### Scenario: Unsupported mirror or transform combination is requested
- **WHEN** the modeling adapter receives a contract-valid mirror or transform definition that the current kernel implementation cannot build
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping body targets, changing references, or guessing alternate geometry

### Requirement: Mirror and transform SHALL include feature-slice test coverage
The mirror/transform implementation SHALL include tests at the contract, authoring, adapter, and e2e levels before the slice is considered complete.

#### Scenario: Mirror/transform unit and integration coverage runs
- **WHEN** the automated test suite runs
- **THEN** it covers mirror/transform validation, draft selection, option handling, draft-to-definition construction, operation-history persistence, snapshot hydration, and adapter-supported or adapter-unsupported behavior

#### Scenario: Mirror/transform e2e flow runs
- **WHEN** the Playwright feature-flow suite runs
- **THEN** it exercises mirror and transform user-facing flows through tool activation, required participant selection, preview or validation feedback, commit, and resulting document or body state in flows comparable to the existing feature e2e tests
