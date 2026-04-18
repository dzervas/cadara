## Purpose
Define how workbench keyboard shortcuts execute editor actions and tool activation through the shared command layer.
## Requirements
### Requirement: Workbench SHALL execute core shortcuts through commands
The workbench SHALL install the shortcut resolver and execute core editor shortcuts through command handlers rather than unrelated component-level keydown handlers.

#### Scenario: Undo shortcut
- **WHEN** the user presses the Undo shortcut outside a text-editing target
- **THEN** the workbench invokes the same active undo context used by toolbar Undo

#### Scenario: Redo shortcut
- **WHEN** the user presses a Redo shortcut outside a text-editing target
- **THEN** the workbench invokes the same active redo context used by toolbar Redo

### Requirement: Tool shortcuts SHALL trigger normal tool activation
Keyboard shortcuts for tools SHALL activate tools through the same action path as toolbar activation while identifying the trigger source as `shortcut`.

#### Scenario: Sketch tool shortcut in sketch mode
- **WHEN** the user is editing a sketch and presses the Line tool shortcut outside a text-editing target
- **THEN** the Line tool activates
- **AND** the tool action event source is `shortcut`

#### Scenario: Part tool shortcut in sketch mode
- **WHEN** the user is editing a sketch and presses a part-mode feature shortcut
- **THEN** the part-mode feature command does not execute

### Requirement: Escape SHALL cancel or close active interactions
The Escape shortcut SHALL cancel or close the current cancelable workbench interaction, SHALL clear the current selection when no higher-priority interaction handles Escape, and SHALL NOT finish the active sketch.

#### Scenario: Escape with cancelable sketch interaction
- **WHEN** a sketch interaction exposes a cancel event and the user presses Escape
- **THEN** the workbench dispatches that cancel event

#### Scenario: Escape while sketch session is idle
- **WHEN** the user is in sketch mode with no cancelable interaction and presses Escape
- **THEN** the workbench does not finish the sketch

#### Scenario: Escape with selection and no active tool
- **WHEN** the user has a workbench selection and no active tool or cancelable interaction handles Escape
- **THEN** the workbench clears the current selection

### Requirement: Finish Sketch SHALL require an explicit shortcut
The workbench SHALL expose Finish Sketch through an explicit shortcut command separate from Escape.

#### Scenario: Finish Sketch shortcut
- **WHEN** the user is editing a sketch and presses the Finish Sketch shortcut
- **THEN** the workbench activates the Finish Sketch tool behavior

#### Scenario: Finish Sketch outside sketch mode
- **WHEN** no sketch session is active and the user presses the Finish Sketch shortcut
- **THEN** the command does not execute

### Requirement: Delete shortcuts SHALL respect selection and text editing
Delete and Backspace shortcuts SHALL execute delete behavior only for eligible workbench selections and SHALL NOT fire while the user is editing text.

#### Scenario: Delete selected sketch annotation
- **WHEN** a sketch constraint or dimension annotation is selected and the user presses Delete outside a text-editing target
- **THEN** the workbench requests annotation deletion

#### Scenario: Backspace in input
- **WHEN** focus is in an input and the user presses Backspace
- **THEN** the shortcut system does not request workbench deletion

