## ADDED Requirements

### Requirement: Feature edit re-entry SHALL use a rollback cursor lifecycle
The workbench SHALL open committed feature edit sessions only after the document cursor has been moved to the position immediately before the edited feature, and SHALL restore the entry cursor when the feature edit session exits.

#### Scenario: Reopen feature from full history
- **WHEN** document history is `sketch - extrude - sketch2 - revolve`
- **AND** the user double-clicks `extrude` while the cursor is at `revolve`
- **THEN** the workbench moves the document cursor to `sketch`
- **AND** opens the `extrude` edit form hydrated from the committed `extrude` definition
- **AND** the document history UI marks `sketch` as the active document cursor while the edit session is active

#### Scenario: Cancel feature edit restores entry cursor
- **WHEN** the user starts editing a committed feature from an entry cursor after `sketch2`
- **AND** the feature edit session is cancelled
- **THEN** the workbench restores the document cursor to after `sketch2`

#### Scenario: Commit feature edit restores entry cursor
- **WHEN** the user starts editing a committed feature from an entry cursor after `sketch2`
- **AND** the feature edit session is committed successfully
- **THEN** the workbench restores the document cursor to after `sketch2`

### Requirement: Sketch edit re-entry SHALL use a rollback cursor lifecycle
The workbench SHALL open committed sketch edit sessions only after the document cursor has been moved to the position immediately before the edited sketch, and SHALL restore the entry cursor when the sketch edit session exits.

#### Scenario: Reopen committed sketch from later history
- **WHEN** document history is `sketch - extrude - sketch2 - revolve`
- **AND** the user double-clicks `sketch2` while the cursor is at `revolve`
- **THEN** the workbench moves the document cursor to `extrude`
- **AND** opens the sketch editor on `sketch2`

#### Scenario: Abort sketch edit restores entry cursor
- **WHEN** the user starts editing a committed sketch from an entry cursor at the history tail
- **AND** the sketch edit session is aborted
- **THEN** the workbench restores the document cursor to the captured history tail

#### Scenario: Finish sketch edit restores entry cursor
- **WHEN** the user starts editing a committed sketch from a non-tail entry cursor
- **AND** the sketch edit session finishes successfully
- **THEN** the workbench restores the document cursor to the captured non-tail entry cursor
