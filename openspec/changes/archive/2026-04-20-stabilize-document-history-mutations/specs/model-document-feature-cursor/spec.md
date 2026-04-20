## ADDED Requirements

### Requirement: Document cursor mutations SHALL use a single editor-owned path
The system SHALL route all user-initiated and edit-orchestration document cursor mutations through the editor runtime's document cursor effect path.

#### Scenario: Timeline drag requests a document cursor move
- **WHEN** the user drags the document timeline cursor to a valid history position
- **THEN** the editor runtime emits one document cursor mutation effect for that target cursor
- **AND** Workbench UI code does not call the modeling service cursor mutation directly for the drag

#### Scenario: Edit rollback requests a document cursor move
- **WHEN** the user reopens a committed sketch or feature for editing
- **THEN** the edit-entry rollback uses the same editor runtime document cursor mutation effect as manual cursor movement
- **AND** the mutation is marked transient so it does not append an authored operation-history entry

#### Scenario: Edit restore requests a document cursor move
- **WHEN** the user exits an edit session that captured an entry cursor
- **THEN** the edit-exit restore uses the same editor runtime document cursor mutation effect as manual cursor movement
- **AND** the mutation is marked transient so it does not append an authored operation-history entry

### Requirement: Document cursor mutation acceptance SHALL refresh before later cursor movement
After an accepted document cursor mutation, the editor runtime SHALL load the authoritative document snapshot before the UI can issue another document cursor mutation from history controls.

#### Scenario: Cursor move is accepted
- **WHEN** a document cursor mutation is accepted by the modeling service
- **THEN** the editor runtime updates the active document revision from the mutation result
- **AND** it requests a fresh document snapshot
- **AND** document history controls remain unavailable until that snapshot is loaded

#### Scenario: Repeated rollback and redo
- **WHEN** a repository-backed document moves the cursor backward, refreshes, moves the cursor forward, refreshes, and moves the cursor backward again
- **THEN** each cursor mutation uses the revision and repository basis from the latest loaded snapshot
- **AND** no stale authored-document conflict notification is produced for the refreshed retry sequence

### Requirement: Document cursor mutation conflicts SHALL recover through refresh
When a document cursor mutation is rejected because the snapshot basis is stale, the editor runtime SHALL clear the pending cursor mutation and refresh the document before allowing a retry.

#### Scenario: Repository head conflict during cursor move
- **WHEN** a document cursor mutation is rejected because repository heads changed after the cursor basis snapshot was loaded
- **THEN** the editor runtime requests a fresh document snapshot
- **AND** the next user cursor mutation uses the refreshed snapshot basis

#### Scenario: Revision conflict during cursor move
- **WHEN** a document cursor mutation is rejected because the requested base revision is stale
- **THEN** the editor runtime requests a fresh document snapshot
- **AND** it does not leave a pending cursor request that blocks later cursor movement
