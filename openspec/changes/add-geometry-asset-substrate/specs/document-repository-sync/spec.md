## ADDED Requirements

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
