## ADDED Requirements

### Requirement: Document undo and redo SHALL use editor-owned cursor mutations
When no sketch-local history or command-stack undo entry applies, document-level Undo and Redo SHALL request document cursor movement through the editor runtime rather than mutating the modeling service directly from Workbench UI code.

#### Scenario: Document undo moves to previous history cursor
- **WHEN** no sketch session is active, no command-stack undo entry exists, and a previous document history cursor exists
- **THEN** activating Undo dispatches an editor document cursor request for the previous cursor
- **AND** Workbench UI code does not call the modeling service cursor mutation directly

#### Scenario: Document redo moves to next history cursor
- **WHEN** no sketch session is active, no command-stack redo entry exists, and a next document history cursor exists
- **THEN** activating Redo dispatches an editor document cursor request for the next cursor
- **AND** Workbench UI code does not call the modeling service cursor mutation directly

### Requirement: Document undo and redo SHALL be unavailable during pending cursor refresh
The workbench SHALL disable document-level Undo and Redo while a document cursor mutation or its required follow-up snapshot refresh is pending.

#### Scenario: Undo is requested during pending cursor mutation
- **WHEN** a document cursor mutation has been requested and the authoritative follow-up snapshot has not loaded
- **THEN** document-level Undo is unavailable
- **AND** activating Undo does not issue another document cursor mutation

#### Scenario: Redo is requested during pending cursor mutation
- **WHEN** a document cursor mutation has been requested and the authoritative follow-up snapshot has not loaded
- **THEN** document-level Redo is unavailable
- **AND** activating Redo does not issue another document cursor mutation
