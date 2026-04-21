## ADDED Requirements

### Requirement: Authored model documents SHALL preserve repairable feature errors
The system SHALL treat a document with a structurally valid authored envelope and history as a valid authored model document even when one or more feature definitions contain repairable rebuild-time errors.

#### Scenario: Load document with invalid feature reference
- **WHEN** an authored model document contains a feature whose durable reference no longer resolves during rebuild
- **THEN** authored document validation accepts the document structure
- **AND** the invalid feature record remains in authored history for editing
- **AND** the failure is represented as a generated diagnostic rather than by deleting or replacing authored records

#### Scenario: Reject malformed document envelope
- **WHEN** an authored model document has an unsupported schema version, invalid top-level discriminant, or missing required authored collection
- **THEN** authored document validation rejects the document explicitly
- **AND** the rejection is not converted into a repairable feature diagnostic

#### Scenario: Persist repairable broken feature
- **WHEN** a user edit leaves a feature in a repairable broken state
- **THEN** persistence stores the authored feature values that the user entered
- **AND** persistence does not store derived render exports or generated diagnostics in the authored model document
