## MODIFIED Requirements

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
