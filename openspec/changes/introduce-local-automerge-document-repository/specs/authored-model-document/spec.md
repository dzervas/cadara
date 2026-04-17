## ADDED Requirements

### Requirement: Authored model document SHALL be the canonical persisted CAD state
The system SHALL define a versioned authored model document as the canonical persisted state for local documents, containing only user-authored and durable rebuild inputs.

#### Scenario: Authored document is stored
- **WHEN** the repository persists a local document
- **THEN** the persisted authored model document includes document identity, schema version, settings, variables, sketches, features, feature ordering, feature cursor state, and authored labels needed to rebuild the model

#### Scenario: Authored document is validated
- **WHEN** the repository loads an authored model document
- **THEN** it validates the document identity, schema version, required authored collections, feature references, sketch references, variable records, and cursor shape before exposing it to the modeling service

### Requirement: Authored model document SHALL exclude derived runtime and presentation state
The authored model document MUST NOT persist derived render exports, feature tree rows, object tree rows, selection catalogs, preview state, diagnostics, OpenCascade runtime objects, or transient editor state.

#### Scenario: Snapshot is rebuilt from authored state
- **WHEN** the modeling service exposes a current document snapshot
- **THEN** it derives the kernel snapshot, presentation rows, diagnostics, and render export from the authored model document and rebuild runtime
- **AND** those derived values are not read as persisted Automerge document fields

#### Scenario: Preview is evaluated
- **WHEN** a feature preview is evaluated
- **THEN** preview geometry and preview diagnostics remain transient
- **AND** they are not written into the authored model document

### Requirement: Authored model document SHALL support schema migration
The system SHALL version authored model documents and provide explicit migrations from supported older authored schemas into the current schema.

#### Scenario: Supported older authored schema is loaded
- **WHEN** the repository loads an authored document with a supported older schema version
- **THEN** it migrates the document to the current authored schema before exposing it to modeling code

#### Scenario: Unsupported authored schema is loaded
- **WHEN** the repository loads an authored document with an unsupported schema version
- **THEN** it rejects the document with an explicit migration diagnostic
- **AND** it preserves the stored data until the user explicitly resets or a later migration supports it
