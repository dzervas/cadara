## ADDED Requirements

### Requirement: Point and Collinear SHALL use domain tool definitions
Point drawing behavior and Collinear constraint behavior SHALL be declared through the existing domain-level sketch tool and sketch constraint definition registries rather than through presentational UI branches.

#### Scenario: Runtime resolves Point
- **WHEN** the sketch runtime activates the Point tool
- **THEN** it resolves the behavior through the registered Point sketch tool definition
- **AND** the implementation does not add a duplicate Point tool ID or a tool-specific React branch

#### Scenario: Runtime resolves Collinear
- **WHEN** the sketch runtime activates `constraintCollinear`
- **THEN** it resolves metadata, selection steps, preview behavior, validation, and commit contribution behavior through the registered Collinear constraint definition

### Requirement: Collinear metadata SHALL be toolbar-ready
The Collinear constraint definition SHALL declare stable metadata for tool ID, group, display name, tooltip, icon, and sketch-mode availability.

#### Scenario: Toolbar consumes Collinear metadata
- **WHEN** the toolbar or command search builds sketch-mode constraint tools
- **THEN** it can display and activate Collinear using metadata from the constraint definition registry
