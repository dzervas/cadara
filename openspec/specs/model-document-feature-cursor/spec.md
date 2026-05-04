# model-document-feature-cursor Specification

## Purpose
TBD - created by archiving change move-feature-tree-to-bottom-timeline. Update Purpose after archive.
## Requirements
### Requirement: Model document SHALL expose a feature cursor
The model document snapshot SHALL include a `cursor` field that identifies the last applied feature in the document feature sequence, or an explicit empty-document state when no features exist.

#### Scenario: Snapshot includes cursor
- **WHEN** the modeling service returns a document snapshot
- **THEN** the snapshot includes a document cursor value that can be resolved against the ordered document feature records

#### Scenario: Empty feature list
- **WHEN** a document has no committed features
- **THEN** the document cursor represents an explicit empty position instead of referencing a missing feature

### Requirement: Document cursor SHALL default to the feature tail
The model document cursor SHALL reference the last feature in the ordered feature list whenever the document has features and is not rolled back.

#### Scenario: Feature append advances the cursor
- **WHEN** a new feature is committed while the cursor is at the current feature tail
- **THEN** the new feature is appended after the current tail and the document cursor references the new feature

#### Scenario: Snapshot initializes with existing features
- **WHEN** a document snapshot is created for an unrolled document with existing features
- **THEN** the document cursor references the last feature in document feature order

### Requirement: Rollback SHALL move the cursor without deleting follow-up authored items
Rollback SHALL update the document cursor to an earlier history position and SHALL preserve authored sketches and features that follow the cursor in document state.

#### Scenario: Roll back before later features
- **WHEN** a document has ordered features `a-b-c-d` and rollback moves the cursor to feature `b`
- **THEN** features `c` and `d` remain in the ordered document feature records after `b`

#### Scenario: Rebuild uses only applied features
- **WHEN** the document cursor is rolled back before later stored features
- **THEN** rebuild and render output are based on features through the cursor and exclude follow-up features after the cursor from the applied model state

#### Scenario: Rebuild uses only applied sketches
- **WHEN** the document cursor is rolled back before a later stored sketch
- **THEN** render, reference resolution, hover, and selection output are based on sketches through the cursor
- **AND** follow-up sketches after the cursor remain stored for later cursor movement but are excluded from the applied model state

### Requirement: New features SHALL insert after the cursor
When a new feature is committed, the system SHALL insert it immediately after the current document cursor and then move the cursor to the new feature.

#### Scenario: Insert after rolled-back cursor
- **WHEN** the document has ordered features `a-b-c-d`, the cursor references `b`, and the user commits new feature `e`
- **THEN** the ordered document feature records become `a-b-e-c-d`
- **AND** the document cursor references feature `e`

#### Scenario: Insert into empty document
- **WHEN** the document has no committed features and the user commits new feature `a`
- **THEN** the ordered document feature records become `a`
- **AND** the document cursor references feature `a`

### Requirement: Cursor references MUST remain valid
The system MUST validate that a non-empty document cursor references an existing feature and MUST surface an explicit diagnostic when persisted or rebuilt document state contains an invalid cursor reference.

#### Scenario: Persisted cursor references a missing feature
- **WHEN** a restored or replayed document cursor references a feature that is not present in the document feature records
- **THEN** restore or rebuild reports an invalid cursor diagnostic instead of silently applying an inferred cursor position

### Requirement: Edit sessions SHALL roll the document cursor before the edited item
When editing an existing committed sketch or feature, the system SHALL move the document cursor to the history position immediately before the edited item before the edit session becomes active.

#### Scenario: Edit a middle feature
- **WHEN** document history is `sketch - extrude - sketch2 - revolve`
- **AND** the user starts editing `extrude`
- **THEN** the document cursor is moved to `sketch`
- **AND** authored items after `sketch` are excluded from the applied model state while the edit session is active

#### Scenario: Edit the first history item
- **WHEN** the edited sketch or feature is the first authored item in document history
- **THEN** the document cursor is moved to the explicit empty-document position

### Requirement: Edit sessions SHALL restore the entry cursor on exit
The system SHALL capture the document cursor that was active before edit-session rollback and SHALL restore that exact cursor after the edit exits.

#### Scenario: Restore a tail cursor after edit
- **WHEN** the document cursor references the history tail before editing begins
- **AND** the user exits the edit session by committing, cancelling, finishing sketch, or aborting sketch
- **THEN** the document cursor is restored to the history tail position captured at edit entry

#### Scenario: Restore a non-tail cursor after edit
- **WHEN** document history is `sketch - extrude - sketch2 - revolve`
- **AND** the document cursor references `sketch2` before the user starts editing `extrude`
- **WHEN** the edit session exits by committing, cancelling, finishing sketch, or aborting sketch
- **THEN** the document cursor is restored to `sketch2`
- **AND** it is not advanced to `revolve` unless `revolve` was the captured entry cursor

### Requirement: Edit-session cursor moves SHALL be transient orchestration
Cursor moves performed solely to enter or exit an edit session SHALL NOT create authored sketch or feature history items and SHALL NOT be treated as feature or sketch mutations.

#### Scenario: Enter and cancel edit session
- **WHEN** the user starts editing a committed feature and then cancels without committing draft changes
- **THEN** document history contains the same authored sketches and features in the same order as before edit entry

#### Scenario: Restore cursor after aborting sketch edit
- **WHEN** the user reopens a committed sketch and then aborts the sketch edit
- **THEN** the only durable document change is the restored cursor position
- **AND** no new sketch commit or feature mutation is recorded for the abort

### Requirement: Cursor persistence SHALL preserve future authored history
The system SHALL preserve every authored sketch and feature after the active document cursor whenever the cursor is saved, restored, or refreshed.

#### Scenario: Rolled-back cursor is saved without truncating history
- **WHEN** document history is `sketch - extrude - sketch2 - revolve`
- **AND** the document cursor is moved to `sketch2`
- **THEN** the durable document cursor references `sketch2`
- **AND** the durable document history still contains `revolve` after `sketch2`

#### Scenario: Restored cursor can advance to future history
- **WHEN** a document is restored with history `sketch - extrude - sketch2 - revolve`
- **AND** the restored cursor references `sketch2`
- **THEN** redo or next-cursor navigation can move the cursor to `revolve`
- **AND** `revolve` is not recreated as a new authored feature

#### Scenario: Rolled-back rebuild remains applied-only
- **WHEN** a document is restored with future authored items after the cursor
- **THEN** rebuild and render output are based only on authored items through the cursor
- **AND** future authored items remain stored for later cursor movement

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

### Requirement: Applied history rebuild SHALL combine cursor range with feature suppression
The model document rebuild SHALL first derive the applied authored history range from the document cursor and SHALL then bypass suppressed features within that applied range without changing the cursor or deleting history.

#### Scenario: Cursor includes suppressed feature
- **WHEN** document history is `sketch - feature a - feature b`
- **AND** the cursor references `feature b`
- **AND** `feature a` is suppressed
- **THEN** rebuild applies the sketch and `feature b` only if their required references resolve without `feature a`
- **AND** `feature a` remains an applied history row with suppressed state
- **AND** the cursor still references `feature b`

#### Scenario: Cursor before suppressed feature
- **WHEN** document history is `sketch - feature a - feature b`
- **AND** the cursor references the sketch before `feature a`
- **AND** `feature a` is suppressed
- **THEN** rebuild output is identical to normal rollback before `feature a`
- **AND** suppression does not make `feature a` or `feature b` part of the applied geometry state

#### Scenario: Cursor target is suppressed
- **WHEN** the cursor references a suppressed feature
- **THEN** the cursor remains valid because the authored feature row still exists
- **AND** rebuild output includes applied unsuppressed rows before that cursor and excludes the suppressed cursor feature's generated geometry

