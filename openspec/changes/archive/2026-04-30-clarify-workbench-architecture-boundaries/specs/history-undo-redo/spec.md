## ADDED Requirements

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

