## ADDED Requirements

### Requirement: Selected sketch geometry SHALL be deletable from an active sketch
The system SHALL allow users editing a sketch to delete selected editable local sketch geometry with Delete or Backspace while keeping the sketch session active.

#### Scenario: User deletes selected sketch entity with Delete
- **WHEN** the user is editing a sketch, a local editable sketch entity is selected, and the user presses Delete
- **THEN** the selected entity is removed from the active sketch definition
- **AND** the sketch session remains active for continued editing
- **AND** the deleted entity is no longer selected or shown as an active edit target

#### Scenario: User deletes selected sketch point with Backspace
- **WHEN** the user is editing a sketch, a local editable sketch point is selected, and the user presses Backspace
- **THEN** the selected point is removed from the active sketch definition
- **AND** the sketch session remains active for continued editing
- **AND** the deleted point is no longer selected or shown as an active edit target

#### Scenario: Delete ignores non-editable sketch selections
- **WHEN** the user is editing a sketch and the current selection is not editable local sketch geometry
- **THEN** invoking Delete does not remove local sketch geometry through the geometry deletion path
