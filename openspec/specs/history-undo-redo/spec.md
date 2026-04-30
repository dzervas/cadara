# history-undo-redo Specification

## Purpose
TBD - created by archiving change add-history-undo-redo. Update Purpose after archive.
## Requirements
### Requirement: Toolbar history tools SHALL use the active undo context
The workbench SHALL route toolbar Undo and Redo actions to the active undo context instead of treating them as generic tool activations or document timeline cursor commands.

#### Scenario: Undo in sketch edit mode
- **WHEN** the user activates Undo while a sketch edit session is active
- **THEN** the workbench moves the active sketch-local history cursor one step backward when a previous sketch history position exists
- **AND** it does not call the document-level cursor mutation service

#### Scenario: Redo in sketch edit mode
- **WHEN** the user activates Redo while a sketch edit session is active
- **THEN** the workbench moves the active sketch-local history cursor one step forward when a later sketch history position exists
- **AND** it does not call the document-level cursor mutation service

#### Scenario: Undo outside sketch mode
- **WHEN** the user activates Undo outside sketch mode
- **THEN** the workbench applies the most recent supported command-stack inverse when one exists
- **AND** it does not move the document timeline cursor

#### Scenario: Redo outside sketch mode
- **WHEN** the user activates Redo outside sketch mode
- **THEN** the workbench reapplies the most recent supported command-stack entry when one exists
- **AND** it does not move the document timeline cursor

### Requirement: Sketch undo and redo SHALL move the sketch-local cursor
Sketch undo and redo SHALL update the active sketch session by moving `SketchSessionState.historyCursor` through the ordered sketch-local history items.

#### Scenario: Sketch undo updates visible sketch state
- **WHEN** a sketch edit session contains multiple authored sketch-local history items and Undo moves the cursor to an earlier item
- **THEN** sketch-local items after the new cursor are treated as after-cursor items
- **AND** displayed sketch geometry and annotations reflect the new cursor position

#### Scenario: Sketch redo updates visible sketch state
- **WHEN** a sketch edit session cursor is before later sketch-local history items and Redo moves the cursor to a later item
- **THEN** displayed sketch geometry and annotations include items through the new cursor position

#### Scenario: Sketch undo before the first item is unavailable
- **WHEN** the active sketch history cursor is before the first sketch-local history item
- **THEN** Undo is unavailable and activating it does not mutate the sketch session

#### Scenario: Sketch redo at the tail is unavailable
- **WHEN** the active sketch history cursor references the last sketch-local history item
- **THEN** Redo is unavailable and activating it does not mutate the sketch session

### Requirement: Variable edit undo and redo SHALL restore variable values
Document variable edits SHALL push undoable command entries that restore the previous and next variable authoring values.

#### Scenario: Undo variable edit
- **WHEN** the user edits a document variable and the mutation is accepted
- **THEN** the workbench pushes an undo entry containing the previous and next variable name and value expression
- **AND** activating Undo restores the previous variable name and value expression through the modeling service

#### Scenario: Redo variable edit
- **WHEN** a variable edit has been undone successfully
- **THEN** activating Redo restores the edited variable name and value expression through the modeling service

#### Scenario: Variable undo conflict
- **WHEN** undoing or redoing a variable edit is rejected by the modeling service
- **THEN** the workbench keeps the undo and redo stacks unchanged
- **AND** it reports the returned diagnostic through existing workbench feedback

### Requirement: Toolbar history availability SHALL be visible
The workbench SHALL derive Undo and Redo availability from the active sketch history context or supported command stack and expose unavailable actions as disabled toolbar controls.

#### Scenario: Sketch history availability
- **WHEN** a sketch edit session is active
- **THEN** Undo availability is based on whether a previous sketch-local cursor position exists
- **AND** Redo availability is based on whether a later sketch-local cursor position exists

#### Scenario: Command stack availability
- **WHEN** no sketch edit session is active
- **THEN** Undo availability is based on whether the workbench undo stack contains a supported command entry
- **AND** Redo availability is based on whether the workbench redo stack contains a supported command entry

#### Scenario: Unsupported commands do not create undo entries
- **WHEN** a modeling mutation does not have V1 inverse semantics
- **THEN** the mutation does not create a toolbar undo entry
- **AND** toolbar Undo does not fall back to moving the document timeline cursor

### Requirement: Sketch geometry deletion SHALL be restored by sketch-local undo
The system SHALL record deletion of selected sketch geometry and its dependent constraints or dimensions as one sketch-local history step that toolbar Undo can reverse while the sketch session is active.

#### Scenario: Undo restores deleted geometry and constraints
- **WHEN** the user deletes selected sketch geometry that has dependent committed constraints or dimensions
- **AND** the user activates toolbar Undo while the same sketch session is active
- **THEN** the deleted sketch geometry is visible and present in the active sketch definition again
- **AND** the dependent constraints or dimensions removed by the deletion are visible and present in the active sketch definition again
- **AND** the sketch session remains active

#### Scenario: Geometry deletion creates one undo step
- **WHEN** the user deletes selected sketch geometry that has dependent committed constraints or dimensions
- **THEN** the deletion is represented as one sketch-local history step
- **AND** one toolbar Undo activation restores both the geometry and the dependent constraints or dimensions

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

### Requirement: Document history reorder undo and redo SHALL restore accepted orders
Accepted document history reorder mutations SHALL create workbench undo-stack entries that restore the previous and next authored document history order.

#### Scenario: Undo accepted reorder
- **WHEN** a document history reorder mutation is accepted
- **AND** the user activates Undo before another higher-priority undo context applies
- **THEN** the workbench requests restoration of the previous authored document history order
- **AND** the reorder entry moves from the undo stack to the redo stack only after the restoration is accepted

#### Scenario: Redo accepted reorder
- **WHEN** a document history reorder has been undone successfully
- **AND** the user activates Redo before another higher-priority redo context applies
- **THEN** the workbench requests restoration of the next authored document history order
- **AND** the reorder entry moves from the redo stack to the undo stack only after the restoration is accepted

#### Scenario: Reorder undo rejected
- **WHEN** restoring a previous or next document history order is rejected or conflicts
- **THEN** the workbench keeps the undo and redo stacks unchanged
- **AND** it reports the returned diagnostic through existing workbench feedback

#### Scenario: Sketch edit mode has priority
- **WHEN** a sketch edit session is active
- **AND** a document history reorder entry exists on the workbench undo stack
- **THEN** toolbar Undo and Redo continue to operate on sketch-local history availability
- **AND** they do not apply the document history reorder entry until sketch edit mode exits

### Requirement: Workbench history actions SHALL resolve through one shared coordination path
The workbench SHALL resolve toolbar and shortcut Undo and Redo actions through one shared application-owned history coordination path that selects the active undo context.

#### Scenario: Toolbar Undo and shortcut Undo share the same coordinator
- **WHEN** the user activates Undo from the toolbar
- **THEN** the workbench invokes the shared history coordination path

- **WHEN** the user activates Undo from a keyboard shortcut
- **THEN** the workbench invokes that same shared history coordination path

#### Scenario: Toolbar Redo and shortcut Redo share the same coordinator
- **WHEN** the user activates Redo from the toolbar
- **THEN** the workbench invokes the shared history coordination path

- **WHEN** the user activates Redo from a keyboard shortcut
- **THEN** the workbench invokes that same shared history coordination path

### Requirement: Shared history coordination SHALL preserve existing undo-context priority
The shared history coordination path SHALL preserve the current undo-context priority across sketch-local history, workbench command-stack history, and document cursor history.

#### Scenario: Sketch session has priority
- **WHEN** a sketch edit session is active and Undo or Redo is requested through the shared history coordination path
- **THEN** the request is resolved against sketch-local history first
- **AND** the coordinator does not fall through to workbench command-stack or document cursor history

#### Scenario: Workbench stack has priority outside sketch mode
- **WHEN** no sketch edit session is active and a supported workbench undo or redo entry exists
- **THEN** the shared history coordination path resolves the request through that workbench stack entry
- **AND** it does not fall through to document cursor history

### Requirement: Shared history coordination SHALL not maintain competing authoritative document history state
The shared workbench history coordinator SHALL select and dispatch the active undo context, but SHALL NOT become a competing authoritative owner of document-facing history state that already belongs to editor runtime or durable modeling history.

#### Scenario: History request is coordinated
- **WHEN** the user requests Undo or Redo through toolbar or shortcut entrypoints
- **THEN** the shared history coordinator selects the active undo context and dispatches the request through the authoritative owner for that context
- **AND** the coordinator does not finalize accepted document-facing history changes by patching snapshots itself

#### Scenario: Document-facing history result is accepted
- **WHEN** a document-facing history action is accepted
- **THEN** the authoritative runtime-owned path sequences any required follow-up refresh
- **AND** the history coordinator remains a dispatcher rather than a second document-state store

