## ADDED Requirements

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
