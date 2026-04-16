# feature-authoring-definition Specification

## ADDED Requirements

### Requirement: Each feature SHALL be defined by its own authoring module
The system SHALL define each feature kind in its own authoring file, and that file MUST be the authoritative source for the feature's identity, authoring behavior, and editor integration metadata.

#### Scenario: Runtime resolves feature behavior from a registry
- **WHEN** the editor runtime needs metadata or behavior for a feature kind such as `extrude`, `revolve`, or `shell`
- **THEN** it resolves that behavior through the registered feature authoring definition for that feature kind rather than a shared feature-type switch

#### Scenario: Adding a new feature
- **WHEN** a new feature kind is introduced
- **THEN** the implementation MUST add a new feature authoring file and register it without requiring unrelated features to be edited in a shared behavior switch

### Requirement: Feature authoring definitions SHALL own feature metadata
Each feature authoring definition SHALL declare the feature metadata needed by the workbench, including stable feature identity, human-readable name, icon metadata, toolbar grouping metadata, and allowed editor mode.

#### Scenario: Toolbar renders feature action metadata
- **WHEN** the toolbar or command system needs to display or activate a feature tool
- **THEN** it uses metadata declared by the feature authoring definition rather than duplicated metadata in a separate per-feature UI mapping

#### Scenario: Editor checks mode availability
- **WHEN** the editor determines whether a feature is available in the current mode
- **THEN** it uses the mode metadata declared by that feature's authoring definition

### Requirement: Feature authoring definitions SHALL own selection semantics
Each feature authoring definition SHALL declare its selection filter and SHALL define how accepted selections are applied to the feature draft.

#### Scenario: Runtime asks a feature which targets are selectable
- **WHEN** a feature command becomes active
- **THEN** the editor resolves the selection filter from the feature authoring definition for that feature

#### Scenario: Runtime applies a selected durable target
- **WHEN** the user selects a durable target while a feature command is active
- **THEN** the active feature authoring definition interprets that target into draft changes according to feature-specific rules

### Requirement: Feature authoring definitions SHALL own draft lifecycle behavior
Each feature authoring definition SHALL define how to create a draft, hydrate a draft from an existing feature snapshot, apply patch updates, derive preview labels, and validate missing inputs for preview and commit.

#### Scenario: Creating a new feature session
- **WHEN** the user starts a create flow for a feature
- **THEN** the runtime creates the initial draft through that feature's authoring definition

#### Scenario: Editing an existing feature
- **WHEN** the user opens an existing feature for editing
- **THEN** the runtime hydrates the authoring draft from the durable feature snapshot through that feature's authoring definition

#### Scenario: Preview request is incomplete
- **WHEN** the user requests or triggers preview with missing required draft inputs
- **THEN** the active feature authoring definition returns feature-specific diagnostics describing the missing inputs

### Requirement: Feature authoring definitions SHALL build modeling definitions without UI ownership leaking into kernels
Each feature authoring definition SHALL translate its draft into the typed modeling `FeatureDefinition` required for preview and commit, and this translation MUST depend only on shared contracts and editor-owned draft state rather than kernel implementation code.

#### Scenario: Preparing a preview request
- **WHEN** the editor runtime needs the typed feature definition for preview
- **THEN** it obtains it from the active feature authoring definition's draft-to-definition builder

#### Scenario: Preserving kernel replaceability
- **WHEN** a feature authoring definition is implemented
- **THEN** it MUST NOT import kernel-specific modules or require kernel-specific types beyond the public modeling contracts

### Requirement: Feature authoring definitions SHALL integrate with a generic editor form contract
Each feature authoring definition SHALL describe its editor using the shared feature editor form schema and MUST be renderable by the generic feature inspector unless it explicitly invokes an allowed escape hatch defined by the form contract.

#### Scenario: Rendering a standard feature editor
- **WHEN** the inspector opens a feature session whose authoring definition uses only standard form elements
- **THEN** the inspector renders the editor from the form schema without feature-specific branching

#### Scenario: Using an approved escape hatch
- **WHEN** a feature has editor needs not covered by the standard field vocabulary
- **THEN** it may supply a defined extension point without forcing the generic inspector to import kernel logic or feature-specific business rules
