# workbench-in-place-editing Specification

## Purpose
TBD - created by archiving change support-in-place-authoring-reentry. Update Purpose after archive.
## Requirements
### Requirement: Double-clicking a committed feature SHALL reopen its edit form
The workbench SHALL reopen a committed feature for in-place editing when the user double-clicks that feature entry, and the resulting edit session SHALL be hydrated from the current committed values.

#### Scenario: Double-click a committed feature
- **WHEN** the user double-clicks a committed feature entry in the workbench tree or timeline context that exposes feature rows
- **THEN** the feature form opens in edit mode for that feature

#### Scenario: Hydrate current committed values
- **WHEN** the reopened feature edit form becomes active
- **THEN** its draft values are prefilled from the current committed feature definition rather than from create-session defaults

### Requirement: Double-clicking a committed sketch SHALL reopen sketch editing in place
The workbench SHALL reopen an existing sketch editor session on a committed sketch when the user double-clicks that sketch entry.

#### Scenario: Double-click a committed sketch
- **WHEN** the user double-clicks a committed sketch entry in the workbench tree
- **THEN** the sketch editor opens on that sketch for continued authoring

#### Scenario: Reopened sketch preserves its authored plane
- **WHEN** the reopened sketch editor session becomes active
- **THEN** the session uses the sketch's stored plane and authored geometry context

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

### Requirement: History entry Edit SHALL match double-click reopen behavior
The workbench SHALL treat context-menu `Edit` on a committed sketch or feature history entry as the same reopen action as double-clicking that same entry.

#### Scenario: Edit committed feature from history menu
- **WHEN** the user selects Edit from the context menu for a committed feature history entry
- **THEN** the workbench opens the same feature edit session that double-clicking that entry would open
- **AND** the same rollback-before-edit cursor lifecycle is used

#### Scenario: Edit committed sketch from history menu
- **WHEN** the user selects Edit from the context menu for a committed sketch history entry
- **THEN** the workbench opens the same sketch edit session that double-clicking that entry would open
- **AND** the same rollback-before-edit cursor lifecycle is used

