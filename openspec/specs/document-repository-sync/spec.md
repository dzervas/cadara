# document-repository-sync Specification

## Purpose
TBD - created by archiving change prepare-document-repository-for-multiplayer-sync. Update Purpose after archive.
## Requirements
### Requirement: Repository SHALL expose head-aware document metadata
The system SHALL expose repository-level causal metadata for the current authored document so modeling freshness checks can distinguish linear local revisions from multi-writer document heads.

#### Scenario: Snapshot is loaded after local mutation
- **WHEN** the modeling service loads a snapshot after an accepted local mutation
- **THEN** repository metadata includes the current document heads for the authored document state used to build that snapshot

#### Scenario: Snapshot is loaded after peer change
- **WHEN** the repository receives a peer-originated document change
- **THEN** repository metadata identifies that the document heads changed outside the current local mutation flow

### Requirement: Repository SHALL notify consumers of document changes
The system SHALL let modeling/runtime code subscribe to authored document changes without exposing Automerge document handles or network adapter details.

#### Scenario: Peer tab changes the document
- **WHEN** another same-origin tab commits a change to the same authored document
- **THEN** the active tab receives a repository change notification
- **AND** the editor runtime can request a fresh modeling snapshot through the existing modeling service path

#### Scenario: Subscriber is disposed
- **WHEN** an editor/runtime subscriber unsubscribes from repository changes
- **THEN** subsequent repository changes do not invoke that subscriber

### Requirement: Repository SHALL support automerge-repo local peer sync
The system SHALL support local peer synchronization for same-origin browser contexts using an internal `automerge-repo` BroadcastChannel network adapter.

#### Scenario: Two tabs edit the same document
- **WHEN** two same-origin tabs open the same document and each commits accepted authored mutations
- **THEN** the repository syncs the authored changes between tabs
- **AND** each tab can rebuild a snapshot containing the merged authored state

#### Scenario: IndexedDB stores merged local peer state
- **WHEN** local peer changes have synced and the application is refreshed
- **THEN** the repository reloads the merged authored document state from local storage

### Requirement: Repository SHALL keep sync implementation isolated
The system SHALL keep Automerge networking, `automerge-repo` handles, sync messages, and storage adapter details inside repository implementation modules.

#### Scenario: UI reacts to peer update
- **WHEN** the UI updates after a peer-originated document change
- **THEN** it does so through modeling service snapshot refresh and editor events
- **AND** it does not import or call Automerge networking APIs

### Requirement: Peer sync SHALL transfer referenced geometry assets automatically
Repository sync SHALL advertise and transfer immutable geometry blobs required by Automerge-authored documents without requiring manual peer re-import.

#### Scenario: Peer receives document referencing new asset
- **WHEN** a peer receives Automerge metadata for an authored document that references an unknown geometry asset
- **THEN** the repository sync layer requests or receives the blob for that asset automatically
- **AND** the peer verifies the received blob against the authored manifest before using it

### Requirement: Asset transfer SHALL be idempotent
Geometry asset sync SHALL deduplicate blobs by content hash across repeated imports, peers, and document refreshes.

#### Scenario: Same asset appears twice
- **WHEN** two features or two peers reference identical geometry bytes
- **THEN** the repository stores one verified blob for the shared hash
- **AND** both authored references resolve to that blob

### Requirement: Peer sync SHALL exclude repository-local durable history metadata
Repository synchronization SHALL share authored CAD document state across peers without turning repository-local durable undo metadata or active draft-edit history into peer-shared history state.

#### Scenario: Peer receives authored document change
- **WHEN** another same-origin tab commits an authored document change
- **THEN** the active tab receives the authored change through normal repository sync
- **AND** it does not receive the remote tab's local durable undo stack as locally undoable history

#### Scenario: Peer has active local draft history
- **WHEN** one tab has active local draft-edit history and another tab opens the same document
- **THEN** authored committed document state may sync between tabs
- **AND** active draft-history metadata is not synchronized as peer-authored document state

