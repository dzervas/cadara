## ADDED Requirements

### Requirement: Runtime schemas SHALL validate authored value wrappers
Shared runtime schemas SHALL validate authored value wrappers at contract and persistence boundaries, including the source discriminant, literal value shape, expression text shape, and whether the field permits expression sources.

#### Scenario: Valid expression wrapper is parsed
- **WHEN** a payload contains an expression-authored value for a field that permits expressions
- **THEN** runtime validation accepts the wrapper shape before runtime expression resolution occurs

#### Scenario: Expression wrapper is used on an unsupported field
- **WHEN** a payload contains an expression-authored value for a reference field, discriminant field, ID field, or other unsupported field
- **THEN** runtime validation rejects the payload with an actionable validation message

### Requirement: Runtime schemas SHALL report actionable authored-value validation failures
Runtime validation failures for authored values SHALL identify whether the failure came from wrapper shape, unsupported expression use, literal type mismatch, missing expression text, or unsupported schema version.

#### Scenario: Literal wrapper has the wrong type
- **WHEN** a positive numeric authored value contains a literal string instead of a number
- **THEN** runtime validation reports that the literal value has the wrong type for that field

#### Scenario: Expression wrapper lacks expression text
- **WHEN** an expression-authored value omits usable expression text
- **THEN** runtime validation reports that expression text is required for that field

### Requirement: Runtime schemas SHALL support explicit legacy literal migration
Shared runtime schemas SHALL either validate canonical authored wrappers or explicitly normalize supported legacy literal payloads through version-aware migration paths.

#### Scenario: Supported legacy literal is loaded
- **WHEN** a supported legacy feature payload contains a raw literal for an eligible field
- **THEN** runtime validation or normalization converts that literal into a literal authored wrapper

#### Scenario: Unsupported mixed shape is loaded
- **WHEN** a payload mixes legacy and authored-value shapes in an unsupported schema version or unsupported field
- **THEN** runtime validation rejects the payload instead of partially normalizing it with ad hoc checks
