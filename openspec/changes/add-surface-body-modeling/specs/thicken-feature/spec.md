## MODIFIED Requirements

### Requirement: Thicken SHALL use explicit topology participants
The thicken feature SHALL define its inputs through explicit topology participants that identify either durable body faces or one sheet body target rather than inferred topology or viewport order.

#### Scenario: Thicken declares required targets
- **WHEN** the thicken authoring definition is registered
- **THEN** it declares required topology participants for durable face targets or one sheet-body target with accepted durable target kinds for each role

#### Scenario: Thicken accepts selected faces
- **WHEN** the user selects accepted durable face targets for the active thicken participant role
- **THEN** the thicken draft records those targets for preview and commit without changing unrelated participant roles

#### Scenario: Thicken accepts a sheet body
- **WHEN** the user selects an accepted sheet body target for the active thicken participant role
- **THEN** the thicken draft records that body target for preview and commit without requiring individual face selection

#### Scenario: Thicken rejects mixed target modes
- **WHEN** the thicken draft contains both face targets and a sheet-body target
- **THEN** validation rejects the draft with a role-specific invalid-target diagnostic

#### Scenario: Thicken rejects an invalid target
- **WHEN** the user selects a durable target that does not match the active thicken participant role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than coercing that target into another role

### Requirement: Thicken SHALL validate thickness options and operation intent
The thicken feature SHALL validate positive thickness options and SHALL require explicit target-body participants for any non-create operation intents that it supports, while treating sheet-body input as source geometry rather than a boolean target.

#### Scenario: Thicken has valid face targets
- **WHEN** the thicken draft has one or more durable face targets and a positive thickness value
- **THEN** preview and commit construction can build a thicken definition

#### Scenario: Thicken has a valid sheet body target
- **WHEN** the thicken draft has one sheet body target and a positive thickness value
- **THEN** preview and commit construction can build a thicken definition

#### Scenario: Thicken has an invalid thickness
- **WHEN** the thicken draft has a missing, zero, negative, or non-finite thickness value
- **THEN** the editor reports a thickness-specific diagnostic and does not commit a feature

#### Scenario: Thicken uses a boolean operation
- **WHEN** the thicken draft uses a supported non-create operation intent
- **THEN** preview and commit validation require at least one explicit solid `targetBody` participant
- **AND** validation rejects sheet bodies as boolean targets

### Requirement: Thicken SHALL round-trip through modeling state
The thicken feature SHALL preserve its face or sheet-body source targets, thickness options, operation intent, diagnostics, produced solid body kind, and feature identity through preview, commit, operation history, snapshots, and edit hydration.

#### Scenario: Face-based thicken is committed
- **WHEN** a valid face-based thicken feature is committed
- **THEN** the operation-history entry stores the thicken feature definition with the committed face participants and thickness options

#### Scenario: Sheet-body thicken is committed
- **WHEN** a valid sheet-body thicken feature is committed
- **THEN** the operation-history entry stores the thicken feature definition with the committed sheet body participant and thickness options
- **AND** the resulting body snapshot records a solid body kind

#### Scenario: Thicken is hydrated for editing
- **WHEN** the user edits an existing thicken feature
- **THEN** the feature authoring draft is reconstructed from the committed thicken source participants, options, and operation intent

#### Scenario: Thicken appears in document views
- **WHEN** a thicken feature has been committed
- **THEN** the document snapshot, feature timeline, object rows, and render bindings expose the committed solid result consistently with other feature kinds

### Requirement: Thicken SHALL handle kernel support explicitly
The thicken implementation SHALL build supported thicken geometry through OCC thick-solid or offset APIs and SHALL return structured unsupported-case diagnostics for valid but unsupported or failed thicken definitions.

#### Scenario: Supported face thicken is previewed
- **WHEN** the modeling adapter receives a supported thicken definition with valid durable face participants and options
- **THEN** preview returns transient solid render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported sheet-body thicken is previewed
- **WHEN** the modeling adapter receives a supported thicken definition with one valid sheet body participant and options
- **THEN** preview returns transient solid render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported thicken is committed
- **WHEN** the modeling adapter receives a supported thicken definition in a commit request
- **THEN** the committed document contains the thicken feature and renderable solid result geometry

#### Scenario: Curved face thicken succeeds
- **WHEN** the modeling adapter receives a curved face or curved sheet input that OCC can offset and close with the authored thickness
- **THEN** the adapter builds the thickened solid result through `BRepOffsetAPI_MakeThickSolid` or `BRepOffsetAPI_MakeOffsetShape`

#### Scenario: Unsupported thicken combination is requested
- **WHEN** the modeling adapter receives a contract-valid thicken definition that the current kernel implementation cannot build
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping participants, changing options, or guessing alternate geometry

#### Scenario: Offset operation fails
- **WHEN** OCC reports invalid offset, self-intersection, non-manifold boundary, orientation ambiguity, or another thickening failure for a contract-valid request
- **THEN** the adapter returns a structured thicken-failed diagnostic instead of committing a partial result

### Requirement: Thicken SHALL include feature-slice test coverage
The thicken implementation SHALL include tests at the contract, authoring, adapter, and e2e levels for both face-based and sheet-body source targets before the rewritten thicken slice is considered complete.

#### Scenario: Thicken unit and integration coverage runs
- **WHEN** the automated test suite runs
- **THEN** it covers thicken validation, face and sheet-body draft selection, option validation, draft-to-definition construction, operation-history persistence, snapshot hydration, supported thick-solid behavior, and unsupported diagnostics

#### Scenario: Thicken e2e flow runs
- **WHEN** the Playwright feature-flow suite runs
- **THEN** it exercises thicken tool activation, required sheet-body target selection, thickness entry, preview or validation feedback, commit, and resulting solid body state in a flow comparable to the existing extrude and other feature e2e tests

## ADDED Requirements

### Requirement: Thicken SHALL produce solids from sheet bodies
Thicken SHALL accept one sheet body as source geometry and SHALL produce a solid body when OCC thickening succeeds.

#### Scenario: Sheet body is thickened
- **WHEN** a thicken definition targets one valid sheet body with a positive thickness
- **THEN** the modeling adapter uses the sheet body's current shape as the source for thickening
- **AND** a successful commit records the result as a solid body

#### Scenario: Multiple sheet bodies are selected
- **WHEN** a thicken definition contains more than one sheet body source target
- **THEN** validation rejects the definition with an explicit invalid-target diagnostic

#### Scenario: Sheet body is missing
- **WHEN** a thicken definition references a sheet body that cannot be resolved
- **THEN** preview, commit, update, rebuild, or replay returns an explicit invalid-reference diagnostic without selecting another body

### Requirement: Thicken SHALL replace planar prism construction
Thicken SHALL use OCC thick-solid or offset APIs rather than constructing planar prisms from selected faces.

#### Scenario: Planar face is thickened
- **WHEN** a planar face thicken request is supported by OCC thick-solid or offset construction
- **THEN** the adapter builds the result through `BRepOffsetAPI_MakeThickSolid` or `BRepOffsetAPI_MakeOffsetShape`
- **AND** it does not use the previous prism-based planar-face-only implementation

#### Scenario: Non-planar face is thickened
- **WHEN** a non-planar face thicken request is supported by OCC offset construction
- **THEN** the adapter builds the result through the same thick-solid or offset path as planar inputs
