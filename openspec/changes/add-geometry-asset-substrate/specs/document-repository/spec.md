## ADDED Requirements

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
