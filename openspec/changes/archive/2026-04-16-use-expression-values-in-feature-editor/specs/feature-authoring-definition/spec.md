## ADDED Requirements

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
