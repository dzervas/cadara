## ADDED Requirements

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

### Requirement: Internal domain invariants MAY remain code-level assertions
The system MAY keep internal geometry, topology, and workflow invariants as code-level assertions when runtime schemas would not reduce code or improve clarity.

#### Scenario: Geometry invariant is violated after payload parsing
- **WHEN** a payload has already passed contract-boundary schema validation but later violates an internal geometry or topology invariant
- **THEN** the implementation may report that failure through code-level assertions rather than forcing the invariant into the shared runtime schema layer
