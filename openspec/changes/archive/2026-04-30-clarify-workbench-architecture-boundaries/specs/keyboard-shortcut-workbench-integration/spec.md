## ADDED Requirements

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
