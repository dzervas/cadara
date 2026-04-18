## ADDED Requirements

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
