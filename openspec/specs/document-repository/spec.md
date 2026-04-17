# document-repository Specification

## Purpose
TBD - created by archiving change introduce-local-automerge-document-repository. Update Purpose after archive.
## Requirements
### Requirement: DocumentRepository SHALL own authored document persistence
The system SHALL define a `DocumentRepository` boundary that owns loading, creating, mutating, subscribing to, and resetting authored model documents without exposing Automerge APIs to UI, editor, viewport, or kernel consumers.

#### Scenario: Modeling service loads a document
- **WHEN** the modeling service initializes the active document
- **THEN** it loads the authored model document through `DocumentRepository`
- **AND** no caller outside the repository receives an Automerge document, handle, or transaction callback

#### Scenario: User resets local document state
- **WHEN** the user invokes the local document reset behavior
- **THEN** `DocumentRepository` clears the persisted authored document state for the active document
- **AND** the next load recreates the seeded empty document through the repository boundary

### Requirement: DocumentRepository SHALL persist locally through automerge-repo IndexedDB storage
The system SHALL persist local authored documents through an internal `automerge-repo` `Repo` configured with IndexedDB storage so document state survives browser refresh and app restart.

#### Scenario: Browser refresh restores authored state
- **WHEN** a user commits accepted modeling mutations and refreshes the application
- **THEN** the application reloads the authored document from IndexedDB through `DocumentRepository`
- **AND** the rebuilt snapshot reflects the committed authored mutations

#### Scenario: Repo implementation remains internal
- **WHEN** repository persistence creates, finds, or changes an `automerge-repo` document handle
- **THEN** `Repo`, `DocHandle`, storage adapter, and handle lifecycle details remain internal to the repository implementation
- **AND** repository consumers receive plain typed authored document records and metadata

#### Scenario: IndexedDB payload is missing
- **WHEN** the repository loads a document ID with no persisted local authored document
- **THEN** it creates the seeded empty authored document with the current supported schema version

### Requirement: DocumentRepository SHALL isolate Automerge implementation details
The system SHALL keep Automerge package imports, `automerge-repo` repositories, document handles, change APIs, and storage adapter details inside the repository implementation layer.

#### Scenario: UI submits a modeling mutation
- **WHEN** a React component, editor state-machine effect, toolbar action, or viewport interaction requests a durable modeling mutation
- **THEN** it calls the existing modeling service contract rather than importing or invoking Automerge APIs

#### Scenario: Kernel rebuild consumes document state
- **WHEN** the OpenCascade-backed rebuild path consumes durable authored data
- **THEN** it receives plain typed authored document records rather than Automerge document objects

### Requirement: DocumentRepository SHALL report restore and migration failures explicitly
The system MUST surface repository load, validation, migration, and write failures through explicit diagnostics or restore status instead of silently falling back to an empty document.

#### Scenario: Persisted authored document has unsupported schema
- **WHEN** startup reads an authored document whose schema version is unsupported
- **THEN** repository restore fails with an explicit unsupported-schema diagnostic
- **AND** the system does not silently replace the document with an empty seeded document

#### Scenario: Repository write fails
- **WHEN** an accepted mutation cannot be written to the local `automerge-repo`-backed store
- **THEN** the system reports a document persistence failure
- **AND** it does not claim the mutation was durably stored

