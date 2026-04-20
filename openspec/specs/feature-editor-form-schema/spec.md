# feature-editor-form-schema Specification

## Purpose
TBD - created by archiving change feature-owned-authoring-spec. Update Purpose after archive.
## Requirements
### Requirement: The feature inspector SHALL render a declarative form schema
The system SHALL define a declarative feature editor form schema that the inspector uses to render feature editors generically instead of branching on feature kind.

#### Scenario: Inspector renders a feature editor from schema data
- **WHEN** a feature session becomes active
- **THEN** the inspector renders the editor from the form schema produced by the active feature authoring definition

#### Scenario: Feature-specific UI branches are removed
- **WHEN** the inspector supports current durable feature kinds
- **THEN** it does not require a hardcoded `if` or `switch` branch per feature kind to render the standard editor flow

### Requirement: The form schema SHALL expose a complete field vocabulary for current feature editors
The form schema SHALL include built-in field and section types for the editor elements required by current and near-term feature editors, including numeric inputs, angle inputs, enum choices, boolean toggles, single-reference pickers, multi-reference collections, read-only summaries, helper text, diagnostics blocks, and grouped action sections.

#### Scenario: Revolve describes angle and axis inputs
- **WHEN** a revolve feature authoring definition describes its editor
- **THEN** the form schema can express its angle fields, profile reference picker, axis reference picker, operation choice, and helper copy without requiring custom feature UI code

#### Scenario: Shell describes body and removable face inputs
- **WHEN** a shell feature authoring definition describes its editor
- **THEN** the form schema can express its source-body picker, removable-face collection, thickness field, and operation choice without requiring custom feature UI code

### Requirement: Form fields SHALL map cleanly to draft patches
Every interactive element in the form schema SHALL resolve to a well-defined draft patch or action so the generic inspector can update feature drafts without knowledge of feature-specific business rules.

#### Scenario: Numeric field changes
- **WHEN** the user edits a numeric field defined by the form schema
- **THEN** the inspector emits the field's declared patch or action to the active feature authoring definition workflow

#### Scenario: Reference picker changes
- **WHEN** the user selects, replaces, or removes a reference-backed field defined by the form schema
- **THEN** the inspector emits the declared patch or action for that field without interpreting feature-specific selection semantics itself

### Requirement: Reference-oriented fields SHALL declare picker behavior explicitly
Reference-backed form elements SHALL declare the selection behavior they require, including accepted target semantics, single versus multi-select behavior, replacement versus append behavior, and how the current value is displayed.

#### Scenario: Single-reference replacement
- **WHEN** a feature defines a single-reference picker such as a plane reference or revolve axis
- **THEN** the schema declares that new valid selections replace the existing value

#### Scenario: Multi-reference append
- **WHEN** a feature defines a multi-reference field such as fillet edges or shell faces
- **THEN** the schema declares whether valid selections append uniquely, reorder, or replace the current collection

### Requirement: The form schema SHALL allow dynamic state-driven presentation without embedding business logic in the inspector
The form schema SHALL support feature-authored dynamic state such as conditional visibility, disabled state, validation messages, and derived labels, while keeping the inspector limited to rendering and event dispatch responsibilities.

#### Scenario: Conditional field availability
- **WHEN** a field should be disabled or hidden based on the current draft state
- **THEN** the active feature authoring definition provides that state through the form schema and the inspector renders it accordingly

#### Scenario: Derived helper text
- **WHEN** a feature needs draft-aware helper text or summary text
- **THEN** the form schema provides that text without requiring the inspector to understand the feature's modeling semantics

### Requirement: The form schema SHALL preserve separation between UI and kernel concerns
The declarative form schema MUST remain independent of kernel implementation details and MUST NOT require UI code to import kernel modules or kernel code to render UI elements.

#### Scenario: Rendering against a different kernel adapter
- **WHEN** the same feature authoring definition is used with a different kernel implementation behind the modeling contract
- **THEN** the generic inspector and form schema continue to function without kernel-specific UI changes

#### Scenario: Implementing a new kernel adapter
- **WHEN** a kernel adapter is added or replaced
- **THEN** it does not need to implement or import UI form components to satisfy the feature editor contract

### Requirement: Non-reference form fields SHALL describe expression-capable authored values
The feature editor form schema SHALL allow non-reference interactive fields to declare whether their value is expression-capable and what value kind the resolver must produce.

#### Scenario: Numeric field declares expression value kind
- **WHEN** a feature authoring definition emits a numeric or angle field whose value can be expression-authored
- **THEN** the field schema includes enough metadata to resolve and validate the authored value as the expected numeric or angle kind

#### Scenario: Boolean or enum field declares expression value kind
- **WHEN** a feature authoring definition emits a boolean, string, or enum-like field whose value can be expression-authored
- **THEN** the field schema includes enough metadata to resolve and validate the authored value as the expected non-reference kind

### Requirement: Reference-oriented form fields MUST remain non-expression fields
Reference picker and reference collection fields MUST continue to carry durable references directly and MUST NOT advertise authored expression support.

#### Scenario: Single reference picker is rendered
- **WHEN** a feature schema includes a reference picker field
- **THEN** the field value remains a durable reference or null
- **AND** the field does not declare expression value metadata

#### Scenario: Reference collection is rendered
- **WHEN** a feature schema includes a reference collection field
- **THEN** the field value remains an ordered collection of durable references
- **AND** the field does not declare expression value metadata

### Requirement: Form field patches SHALL preserve authored expression text
The generic form adapter SHALL be able to emit draft patches that preserve raw expression text for expression-capable non-reference fields instead of coercing all edited values into their resolved runtime type.

#### Scenario: Numeric expression text is patched
- **WHEN** a user-entered numeric field value is not parseable as a finite number but is accepted as expression text
- **THEN** the form adapter emits a patch preserving the raw expression text
- **AND** the adapter does not convert the text with `Number(...)` before feature authoring receives it

#### Scenario: Literal numeric text is patched
- **WHEN** a user-entered numeric field value is parseable as a finite number
- **THEN** the form adapter may emit the value as a literal authored source for that numeric field

### Requirement: The form schema SHALL render grouped and discriminated option controls
The declarative feature editor form schema SHALL support nested option groups and discriminated option groups so feature authoring definitions can expose advanced CAD controls without feature-specific inspector branches.

#### Scenario: Discriminated option group renders active variant
- **WHEN** a feature form schema includes a discriminated option group
- **THEN** the generic inspector renders the discriminant control and only the fields for the active variant unless the schema explicitly marks inactive fields visible

#### Scenario: Nested option group patches draft state
- **WHEN** the user edits a field inside a nested option group
- **THEN** the inspector emits the field's declared patch without interpreting the feature's modeling semantics

### Requirement: The form schema SHALL support positive integer and conditional advanced fields
The form schema SHALL include enough field metadata for positive integer inputs and feature-authored conditional visibility, disabled state, and validation messages in advanced option sections.

#### Scenario: Section count field is rendered
- **WHEN** a loft path option exposes `sectionCount`
- **THEN** the schema can render it as a positive integer field with authored value metadata and field-specific diagnostics

#### Scenario: Conditional field is hidden
- **WHEN** a field applies only to an inactive option variant
- **THEN** the feature authoring definition marks it hidden or disabled through schema state and the inspector renders that state generically

