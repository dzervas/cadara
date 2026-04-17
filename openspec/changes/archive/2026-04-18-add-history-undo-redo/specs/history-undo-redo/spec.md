## ADDED Requirements

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
