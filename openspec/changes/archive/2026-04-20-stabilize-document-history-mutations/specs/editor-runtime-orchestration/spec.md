## ADDED Requirements

### Requirement: Editor runtime SHALL sequence document cursor effects
The editor runtime SHALL own document cursor effect sequencing, stale-result rejection, accepted-result revision updates, and follow-up snapshot refreshes.

#### Scenario: Cursor effect is in flight
- **WHEN** a document cursor effect is in flight
- **THEN** the editor runtime tracks the pending cursor request ID
- **AND** stale cursor responses for other request IDs do not mutate the active editor state

#### Scenario: Accepted cursor effect completes
- **WHEN** an accepted document cursor effect completes
- **THEN** the editor runtime records the returned document revision
- **AND** it requests a fresh snapshot before treating the cursor move as complete

#### Scenario: Cursor effect conflicts
- **WHEN** a document cursor effect completes with a stale revision or repository-head conflict
- **THEN** the editor runtime clears the pending cursor request
- **AND** it requests a fresh snapshot for recovery

### Requirement: Editor view state SHALL expose pending document cursor availability
The editor view state SHALL expose document history availability that accounts for pending cursor mutations and pending cursor follow-up snapshot refreshes.

#### Scenario: Pending cursor mutation disables document history actions
- **WHEN** a document cursor mutation or its follow-up snapshot refresh is pending
- **THEN** document-level history Undo and Redo are unavailable in the editor view state

#### Scenario: Cursor refresh completes
- **WHEN** the authoritative snapshot after a cursor mutation is loaded
- **THEN** document-level history Undo and Redo availability is recomputed from the refreshed snapshot
