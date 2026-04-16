# runtime-contract-validation Specification

## Purpose
TBD - created by archiving change introduce-zod-contract-validation. Update Purpose after archive.
## Requirements
### Requirement: Externally sourced and persisted contract payloads SHALL be validated by shared runtime schemas
The system SHALL validate externally sourced and persisted payloads through shared runtime schemas rather than through duplicated handwritten record and field checks spread across multiple modules.

#### Scenario: Frontend reads a modeling snapshot payload
- **WHEN** the frontend modeling boundary receives a document snapshot or render-export payload
- **THEN** it validates that payload through the shared runtime schema for that contract family before exposing typed data to the rest of the application

#### Scenario: Application loads persisted operation history
- **WHEN** the application reads a serialized operation-history payload from persistence
- **THEN** it validates that payload through the shared runtime schema for operation history before attempting replay

### Requirement: Contract-boundary validation failures SHALL expose actionable messages
The system SHALL surface explicit validation messages for high-signal boundary failures, including version mismatches, malformed persisted payloads, missing required top-level sections, invalid non-empty collections, and invalid positive numeric fields where required by the contract.

#### Scenario: Payload uses an unsupported version
- **WHEN** a request, response, snapshot, or persisted history payload declares an unsupported contract or schema version
- **THEN** the validation failure explicitly identifies the mismatched version field and the expected version

#### Scenario: Persisted history payload is malformed
- **WHEN** persistence loading encounters malformed or structurally invalid operation-history data
- **THEN** the system surfaces an actionable validation message instead of a generic unknown parse failure

### Requirement: Internal domain invariants SHALL be allowed to remain code-level assertions
The system SHALL allow internal geometry, topology, and workflow invariants to remain as code-level assertions when runtime schemas would not reduce code or improve clarity.

#### Scenario: Geometry invariant is violated after payload parsing
- **WHEN** a payload has already passed contract-boundary schema validation but later violates an internal geometry or topology invariant
- **THEN** the implementation may report that failure through code-level assertions rather than forcing the invariant into the shared runtime schema layer

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

