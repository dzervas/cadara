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

### Requirement: DocumentRepository SHALL round-trip rolled-back authored documents
The repository-backed document persistence path SHALL store and restore the complete authored document timeline and the active cursor, even when the active modeling snapshot is rolled back before the history tail.

#### Scenario: Refresh restores future feature after rolled-back cursor
- **WHEN** a repository-backed document contains history `sketch - extrude - sketch2 - revolve`
- **AND** the cursor is moved to `sketch2`
- **AND** the application refreshes or a fresh modeling service loads the same repository document
- **THEN** the restored authored document still contains `revolve`
- **AND** the restored cursor still references `sketch2`
- **AND** the restored document history order remains `sketch - extrude - sketch2 - revolve`

#### Scenario: Repository write after cursor move includes full timeline
- **WHEN** the modeling service persists an accepted cursor move
- **THEN** the document written through `DocumentRepository` includes all sketches, all features, complete feature order, complete history order, and the requested cursor
- **AND** persisted feature records after the cursor are not filtered to match the applied rebuild output

#### Scenario: Applied snapshot cannot overwrite future authored records
- **WHEN** the current viewport snapshot excludes future feature geometry because the cursor is rolled back
- **THEN** repository persistence still writes from complete authored inputs
- **AND** it does not replace the repository document with a document containing only the applied prefix

### Requirement: Repository freshness SHALL compare against the mutation basis
For repository-backed documents, the modeling service SHALL detect authored-document freshness conflicts by comparing current repository metadata with the repository heads supplied by the mutation basis.

#### Scenario: Mutation basis heads are stale
- **WHEN** a modeling mutation supplies repository heads from an older snapshot
- **AND** the repository's current heads differ from those basis heads
- **THEN** the modeling service rejects the mutation with a repository-head conflict diagnostic
- **AND** it does not persist stale authored document state

#### Scenario: Mutation basis heads are current
- **WHEN** a modeling mutation supplies repository heads that match the repository's current heads
- **THEN** repository freshness does not reject the mutation

#### Scenario: Repository provenance is absent
- **WHEN** a modeling mutation does not include repository heads because the snapshot was not repository-backed
- **THEN** repository freshness checks do not reject the mutation solely because no heads were supplied

### Requirement: Repository cursor conflict recovery SHALL preserve authored history
After a stale cursor mutation is rejected and the editor refreshes, retrying cursor movement SHALL preserve the complete authored document timeline.

#### Scenario: Refresh after stale cursor mutation
- **WHEN** a stale document cursor mutation is rejected for a repository-head conflict
- **AND** the editor refreshes the document snapshot
- **THEN** the refreshed snapshot exposes the complete authored history order
- **AND** future authored sketches and features after the cursor remain available for redo navigation

#### Scenario: Retried cursor mutation after refresh
- **WHEN** the user retries document cursor movement after the refreshed snapshot is loaded
- **THEN** the cursor mutation uses the refreshed repository heads
- **AND** the mutation does not overwrite future authored history with an applied-only snapshot prefix

