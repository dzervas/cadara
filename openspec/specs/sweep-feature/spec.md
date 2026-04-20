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

### Requirement: Sweep SHALL support profile control options
The sweep feature SHALL preserve and execute profile control options for none, keep profile orientation, lock profile faces, and lock profile direction.

#### Scenario: No profile control is selected
- **WHEN** a sweep definition uses profile control `none`
- **THEN** the sweep executes using the default path-driven profile orientation behavior

#### Scenario: Keep profile orientation is selected
- **WHEN** a sweep definition uses profile control `keepProfileOrientation`
- **THEN** the sweep maintains the profile's orientation relationship along the path

#### Scenario: Lock profile faces is selected
- **WHEN** a sweep definition uses profile control `lockProfileFaces`
- **THEN** the definition preserves one or more selected durable face references
- **AND** validation rejects the feature if no face reference is selected or if any selected lock target is not a face

#### Scenario: Lock profile direction is selected
- **WHEN** a sweep definition uses profile control `lockProfileDirection`
- **THEN** the definition preserves exactly one selected durable edge or construction reference as the direction reference
- **AND** validation rejects the feature if the direction reference is missing or has any other target kind

### Requirement: Sweep SHALL support discriminated twist options
The sweep feature SHALL represent twist as an optional discriminated option with turns, angle, and pitch variants.

#### Scenario: Turns twist is authored
- **WHEN** a sweep definition uses twist type `turns`
- **THEN** the durable definition stores only the authored revolutions value for the active twist variant

#### Scenario: Angle twist is authored
- **WHEN** a sweep definition uses twist type `angle`
- **THEN** the durable definition stores only the authored angle value for the active twist variant

#### Scenario: Pitch twist is authored
- **WHEN** a sweep definition uses twist type `pitch`
- **THEN** the durable definition stores only the authored pitch value for the active twist variant

#### Scenario: Twist is disabled
- **WHEN** a sweep definition disables twist
- **THEN** no inactive turns, angle, or pitch values affect preview, commit, rebuild, or operation-history replay

### Requirement: Sweep SHALL support end scale
The sweep feature SHALL support an optional positive end scale factor that proportionally transforms the profile size at the end of the sweep path.

#### Scenario: End scale is authored
- **WHEN** a sweep definition contains a scale factor greater than zero
- **THEN** the sweep profile transitions from its starting size to the requested proportional end size along the sweep path

#### Scenario: Scale is one
- **WHEN** a sweep definition has scale factor `1`
- **THEN** geometry execution treats the feature equivalently to an unscaled sweep

### Requirement: Advanced sweep controls SHALL execute through OCC
Advanced sweep profile control, twist, and scale options SHALL be implemented in the OpenCascade-backed modeling adapter for supported profile/path combinations.

#### Scenario: Advanced sweep preview runs
- **WHEN** preview receives a valid sweep with advanced controls
- **THEN** the adapter returns transient geometry reflecting the requested controls and no unsupported-case diagnostic

#### Scenario: Advanced sweep commit runs
- **WHEN** commit receives a valid sweep with advanced controls
- **THEN** the adapter commits the sweep feature and persisted snapshots hydrate the same advanced control values for editing

### Requirement: Sweep SHALL define a minimum supported advanced geometry matrix
The sweep implementation SHALL treat each profile control option, each twist variant, and non-1 end scale as required geometry paths in at least one representative profile/path case.

#### Scenario: Minimum profile control matrix is tested
- **WHEN** the OCC sweep adapter test suite runs
- **THEN** it includes successful preview or commit coverage for default profile control, keep profile orientation, lock profile faces, and lock profile direction

#### Scenario: Minimum twist and scale matrix is tested
- **WHEN** the OCC sweep adapter test suite runs
- **THEN** it includes successful preview or commit coverage for twist by turns, twist by angle, twist by pitch, and end scale with a factor other than `1`
