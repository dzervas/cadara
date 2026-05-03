## ADDED Requirements

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
