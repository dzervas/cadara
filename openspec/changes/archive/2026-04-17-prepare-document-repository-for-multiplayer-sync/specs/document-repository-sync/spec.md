## ADDED Requirements

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
