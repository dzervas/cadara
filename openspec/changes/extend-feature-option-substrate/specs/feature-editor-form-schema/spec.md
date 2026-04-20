## ADDED Requirements

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
