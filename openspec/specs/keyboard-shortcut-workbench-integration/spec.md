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
The Escape shortcut SHALL cancel or close the current cancelable workbench interaction, SHALL clear the current selection when no higher-priority interaction handles Escape, and SHALL NOT finish the active sketch. With an armed sketch drawing tool, each Escape SHALL take one step, in order: close an open candidate chooser; end an active Line chain (Line stays armed); finalize a fit-point spline draft that has its minimum points (one action, Spline stays armed); cancel any other incomplete draft without an action (the tool stays armed); otherwise leave the tool for Select. Edit, constraint and special-mode tools SHALL leave on one Escape.

#### Scenario: Escape with cancelable sketch interaction
- **WHEN** a sketch interaction exposes a cancel event and the user presses Escape
- **THEN** the workbench dispatches that cancel event

#### Scenario: Escape cancels an incomplete drawing draft
- **WHEN** a sketch drawing tool such as Circle has an incomplete draft and the user presses Escape
- **THEN** the draft is discarded without a history action
- **AND** the tool stays armed

#### Scenario: Escape leaves an armed drawing tool with no draft
- **WHEN** a sketch drawing tool is armed with no draft and the user presses Escape
- **THEN** the tool is cleared and the sketch returns to Select

#### Scenario: Escape leaves an edit or constraint tool at once
- **WHEN** a sketch edit or constraint tool is active and the user presses Escape
- **THEN** the tool is cleared on that one Escape

### Requirement: Enter SHALL complete a drawing step only when one applies
The Enter shortcut SHALL end an active Line chain or finalize a fit-point spline draft that has its minimum points, keeping the tool armed. When neither applies, the shortcut SHALL NOT consume Enter. When it applies, the consumed Enter SHALL NOT also activate a focused toolbar button.

#### Scenario: Enter with nothing to complete
- **WHEN** a sketch drawing tool is armed with no chain and no viable spline draft and the user presses Enter
- **THEN** the shortcut system does not handle the key

#### Scenario: Enter on a focused toolbar button
- **WHEN** a toolbar button has focus, Enter applies to the armed drawing tool and the user presses Enter
- **THEN** the shortcut system consumes the key so the button is not activated and the tool is not restarted

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

### Requirement: Shortcut handlers SHALL reuse shared application command entrypoints
Workbench keyboard shortcut handlers SHALL invoke the same shared application command entrypoints used by toolbar or other UI actions instead of maintaining separate orchestration logic.

#### Scenario: Undo shortcut reuses the shared history entrypoint
- **WHEN** the user presses the Undo shortcut outside a text-editing target
- **THEN** the shortcut handler invokes the shared application-owned history entrypoint used by toolbar Undo

#### Scenario: Redo shortcut reuses the shared history entrypoint
- **WHEN** the user presses the Redo shortcut outside a text-editing target
- **THEN** the shortcut handler invokes the shared application-owned history entrypoint used by toolbar Redo

#### Scenario: Tool shortcut reuses the shared tool activation entrypoint
- **WHEN** the user presses a tool shortcut outside a text-editing target
- **THEN** the shortcut handler invokes the shared application-owned tool activation entrypoint
- **AND** the resulting tool behavior matches toolbar activation for the same tool and editor context

