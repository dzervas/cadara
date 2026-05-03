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

### Requirement: DocumentRepository SHALL preserve repairable semi-broken documents
The repository restore path SHALL preserve structurally valid authored documents that contain repairable feature rebuild errors and SHALL NOT clear, delete, reset, or replace them as a recovery action.

#### Scenario: Restore repairable broken document
- **WHEN** the repository loads a structurally valid authored document whose later feature cannot rebuild
- **THEN** the repository exposes the authored document to the modeling service
- **AND** it does not seed an empty replacement document
- **AND** it does not remove the broken feature from authored history

#### Scenario: Recovery does not reset storage
- **WHEN** a recoverable feature-scoped document error is detected during startup
- **THEN** `DocumentRepository` preserves the persisted authored document state
- **AND** no repository reset, clear, or delete operation is invoked as part of recovery

#### Scenario: Explicit reset remains separate
- **WHEN** a user independently invokes an explicit document reset command outside feature-error recovery
- **THEN** that command remains a distinct user action
- **AND** recoverable document error messaging does not present reset as the fix

### Requirement: Repositories SHALL persist geometry blobs separately from Automerge fields
Document repositories SHALL store immutable geometry asset bytes outside the Automerge CRDT object graph while keeping them associated with the authored document.

#### Scenario: Mutate document with geometry assets
- **WHEN** a repository-backed mutation writes an authored document that references geometry assets
- **THEN** the Automerge document stores the authored manifest and feature references
- **AND** the repository stores required blob bytes in a companion content-addressed asset store

### Requirement: Local asset mutations SHALL publish atomically
Repository mutations that introduce new geometry asset references SHALL verify required local blobs before publishing the Automerge-authored manifest.

#### Scenario: Local asset blob cannot be stored
- **WHEN** a local mutation introduces a geometry asset reference but the repository cannot store or verify the corresponding blob
- **THEN** the mutation fails with a structured repository diagnostic
- **AND** the Automerge document is not updated with a manifest that references the missing blob

### Requirement: Repository restore SHALL report missing assets
Document repositories SHALL report structured diagnostics when referenced geometry assets are unavailable during restore.

#### Scenario: Restore before blob is available
- **WHEN** the Automerge document references a geometry asset that is absent from local blob storage
- **THEN** repository restore succeeds with a missing-asset diagnostic
- **AND** the modeling service can refresh after the asset blob is received

### Requirement: DocumentRepository SHALL expose plain durable history operations
The system SHALL extend the `DocumentRepository` boundary with plain durable-history operations for local undo/redo availability and application so callers do not depend on Automerge handles, heads, or transaction APIs.

#### Scenario: Runtime queries durable history availability
- **WHEN** application or runtime code needs Undo and Redo availability for the active local document context
- **THEN** it queries the repository through plain durable-history contracts
- **AND** no caller outside the repository receives an Automerge handle, head set, or transaction callback

#### Scenario: Runtime applies a durable history step
- **WHEN** the shared durable-history coordinator requests Undo or Redo
- **THEN** the repository applies the requested local history step through its own persistence implementation
- **AND** the caller receives plain typed result data rather than Automerge internals

### Requirement: DocumentRepository SHALL persist local durable history separately from authored document state
The repository SHALL persist local durable undo/redo metadata on top of its internal local storage substrate while keeping that metadata separate from the canonical authored model document contract.

#### Scenario: Refresh restores local undo and redo availability
- **WHEN** the local editing context records durable history groups and the application refreshes
- **THEN** the repository restores both the authored document and the local durable history metadata for that context
- **AND** Undo and Redo availability after refresh reflects the restored local history state

#### Scenario: Authored document export excludes local durable history metadata
- **WHEN** the modeling boundary exports or validates the canonical authored document
- **THEN** the payload includes only authored CAD state
- **AND** repository-local durable undo metadata is not serialized as authored document fields

### Requirement: DocumentRepository SHALL persist local draft edit history
The repository SHALL support local durable draft-edit history for document-changing edit sessions without treating that history as committed authored CAD state.

#### Scenario: Draft session survives refresh
- **WHEN** a covered draft edit session has recorded local durable draft-history groups and the local editing context refreshes
- **THEN** the repository can restore the local draft-history state for that session
- **AND** committed authored document state remains distinct from uncommitted draft state

#### Scenario: Explicit draft cancellation clears draft history
- **WHEN** the user explicitly cancels or abandons a draft edit session
- **THEN** the repository clears the local draft-history state for that session
- **AND** committed authored document history remains intact

