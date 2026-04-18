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

### Requirement: Rollback SHALL move the cursor without deleting follow-up features
Rollback SHALL update the document cursor to an earlier feature position and SHALL preserve features that follow the cursor in document state.

#### Scenario: Roll back before later features
- **WHEN** a document has ordered features `a-b-c-d` and rollback moves the cursor to feature `b`
- **THEN** features `c` and `d` remain in the ordered document feature records after `b`

#### Scenario: Rebuild uses only applied features
- **WHEN** the document cursor is rolled back before later stored features
- **THEN** rebuild and render output are based on features through the cursor and exclude follow-up features after the cursor from the applied model state

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

