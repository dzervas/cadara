# feature-authoring-definition Specification

## Purpose
TBD - created by archiving change feature-owned-authoring-spec. Update Purpose after archive.
## Requirements
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
Each feature authoring definition SHALL declare its selection filter and SHALL define how accepted selections are applied to the feature draft, including activation-time reuse of the current selection.

#### Scenario: Runtime asks a feature which targets are selectable
- **WHEN** a feature command becomes active
- **THEN** the editor resolves the selection filter from the feature authoring definition for that feature

#### Scenario: Runtime applies a selected durable target
- **WHEN** the user selects a durable target while a feature command is active
- **THEN** the active feature authoring definition interprets that target into draft changes according to feature-specific rules

#### Scenario: Runtime seeds a feature draft from current selection
- **WHEN** a feature command becomes active while the current durable selection is compatible with that feature's selection filter
- **THEN** the editor replays those selected targets through the active feature authoring definition in selection order
- **AND** the resulting draft changes use the same feature-specific selection semantics as later interactive picks

#### Scenario: Runtime clears incompatible current selection for a feature
- **WHEN** a feature command becomes active while the current selection does not satisfy that feature's selection filter
- **THEN** the editor clears the current selection
- **AND** it does not partially apply the incompatible selection to the new feature draft

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

### Requirement: Feature authoring definitions SHALL preserve authored values through the draft lifecycle
Feature authoring definitions SHALL create, hydrate, patch, and build feature drafts without losing whether an eligible non-reference value was authored as a literal or as expression text.

#### Scenario: Existing expression-authored feature is edited
- **WHEN** the editor hydrates a feature draft from a durable feature definition containing an expression-authored value
- **THEN** the draft preserves the raw expression text for that value

#### Scenario: Draft is built into a feature definition
- **WHEN** a feature authoring definition builds a durable feature definition from a draft containing authored values
- **THEN** the built definition preserves literal and expression sources for all eligible non-reference values

### Requirement: Feature authoring definitions SHALL declare value metadata without resolving expressions
Feature authoring definitions SHALL declare the value-kind metadata needed to resolve expression-capable fields, but MUST NOT parse or evaluate math expressions inside feature-specific authoring modules.

#### Scenario: Feature authoring emits a numeric field
- **WHEN** a feature authoring definition emits a numeric or angle field
- **THEN** it declares the field's value kind and domain constraints for the shared resolver
- **AND** it does not import kernel adapter modules to resolve that value

#### Scenario: Feature authoring builds a preview definition
- **WHEN** the editor runtime asks a feature authoring definition for a preview definition
- **THEN** the feature authoring definition returns an authored feature definition
- **AND** expression resolution is delegated to the shared modeling resolver before execution

### Requirement: Feature authoring definitions SHALL keep reference semantics separate from authored values
Feature authoring definitions SHALL continue to apply selection and reference patches as durable references, independent from authored value expression handling.

#### Scenario: Feature selection is applied
- **WHEN** a user selects a durable target while a feature command is active
- **THEN** the active feature authoring definition applies that target through its existing reference semantics
- **AND** the target is not wrapped as an authored expression value

### Requirement: Combine SHALL be owned by a registered feature authoring definition
Combine SHALL be implemented as a registered feature authoring definition that owns its metadata, selection behavior, draft lifecycle, validation, form schema, and draft-to-definition conversion.

#### Scenario: Toolbar metadata comes from Combine authoring definition
- **WHEN** the part-mode toolbar renders the Combine tool
- **THEN** it uses metadata from the registered Combine feature authoring definition
- **AND** the toolbar does not keep a separate static Combine command that only logs tool activation

#### Scenario: Combine selection applies through authoring definition
- **WHEN** the user selects a durable body while a Combine session is active
- **THEN** the Combine authoring definition decides whether the body updates the target-body or tool-body draft field

#### Scenario: Combine builds typed feature definition
- **WHEN** preview or commit needs a Combine feature definition
- **THEN** the Combine authoring definition translates the draft into the public typed modeling contract without importing kernel-specific modules

### Requirement: Feature authoring SHALL define STEP import settings
Feature authoring SHALL expose a typed STEP import definition containing the STEP asset reference and resolved import settings.

#### Scenario: Build STEP import definition
- **WHEN** the user accepts a STEP import
- **THEN** the authoring layer builds a feature definition with file asset id, unit/scale decision, orientation, placement transform, and label
- **AND** the definition does not embed STEP bytes directly

### Requirement: Feature authoring SHALL represent mesh import provenance
Feature authoring SHALL record mesh import provenance and baked asset references without embedding source mesh data.

#### Scenario: Build mesh import definition
- **WHEN** a mesh import is accepted
- **THEN** the feature definition includes baked asset id, source format, original filename, source hash, resolved scale/orientation settings, and `sourceStored: false`
- **AND** the definition excludes raw mesh bytes and triangle arrays

### Requirement: Mesh reconstruction UI SHALL expose quality diagnostics and settings
Feature authoring for mesh import SHALL expose reconstruction settings and result diagnostics needed to make an informed commit decision.

#### Scenario: User reviews reconstruction result
- **WHEN** reconstruction finishes before mesh import commit
- **THEN** the authoring UI presents result classification, relevant settings, warnings, and diagnostics
- **AND** it does not imply that the original mesh can be reprocessed after save

