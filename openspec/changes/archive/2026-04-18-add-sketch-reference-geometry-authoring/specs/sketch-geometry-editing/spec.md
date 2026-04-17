## ADDED Requirements

### Requirement: Active sketch editing SHALL include selectable projected reference geometry
The system SHALL allow projected external reference geometry to participate in active sketch hover and selection flows as read-only reference targets.

#### Scenario: User hovers projected reference geometry
- **WHEN** the user is editing a sketch and points at projected reference geometry
- **THEN** the viewport shows hover feedback for the projected reference target
- **AND** the editor does not offer direct drag editing for that target

#### Scenario: Local and projected targets overlap
- **WHEN** local sketch geometry and projected reference geometry overlap under the pointer
- **THEN** editing workflows that require local geometry prioritize the local editable target
- **AND** workflows that accept reference geometry can still resolve the projected reference target
