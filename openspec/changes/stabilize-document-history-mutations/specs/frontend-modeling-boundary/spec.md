## ADDED Requirements

### Requirement: Snapshot-based modeling mutations SHALL carry an explicit mutation basis
Frontend-facing modeling mutations initiated from a document snapshot SHALL carry the snapshot revision and, when available, repository provenance for the authored document basis used by the caller.

#### Scenario: Document cursor move from repository-backed snapshot
- **WHEN** the editor requests a document cursor move from a repository-backed snapshot
- **THEN** the modeling service receives the snapshot's `baseRevisionId`
- **AND** it receives the repository heads from that snapshot as the mutation's repository basis

#### Scenario: Feature commit from repository-backed snapshot
- **WHEN** the editor commits a feature draft from a repository-backed snapshot
- **THEN** the modeling service receives the snapshot's `baseRevisionId`
- **AND** it receives the repository heads from that snapshot as the mutation's repository basis

#### Scenario: Mutation from non-repository snapshot
- **WHEN** the editor requests a modeling mutation from a snapshot without repository provenance
- **THEN** the modeling service evaluates the mutation against the snapshot revision
- **AND** it does not require repository heads to be present

### Requirement: UI components SHALL not bypass editor/runtime mutation sequencing
React UI components SHALL not call modeling-service document cursor mutation APIs directly for document history navigation.

#### Scenario: Timeline cursor moves
- **WHEN** a timeline component needs to move the document cursor
- **THEN** it dispatches an editor event or callback that is handled by editor runtime sequencing

#### Scenario: Toolbar document history moves
- **WHEN** toolbar Undo or Redo falls back to document history cursor navigation
- **THEN** Workbench routes the request through editor runtime sequencing instead of invoking the modeling service cursor mutation directly
