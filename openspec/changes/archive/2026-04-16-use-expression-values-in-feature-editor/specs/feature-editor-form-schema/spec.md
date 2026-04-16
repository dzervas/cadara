## ADDED Requirements

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
