## ADDED Requirements

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

