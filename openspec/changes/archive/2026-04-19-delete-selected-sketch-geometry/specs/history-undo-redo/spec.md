## ADDED Requirements

### Requirement: Sketch geometry deletion SHALL be restored by sketch-local undo
The system SHALL record deletion of selected sketch geometry and its dependent constraints or dimensions as one sketch-local history step that toolbar Undo can reverse while the sketch session is active.

#### Scenario: Undo restores deleted geometry and constraints
- **WHEN** the user deletes selected sketch geometry that has dependent committed constraints or dimensions
- **AND** the user activates toolbar Undo while the same sketch session is active
- **THEN** the deleted sketch geometry is visible and present in the active sketch definition again
- **AND** the dependent constraints or dimensions removed by the deletion are visible and present in the active sketch definition again
- **AND** the sketch session remains active

#### Scenario: Geometry deletion creates one undo step
- **WHEN** the user deletes selected sketch geometry that has dependent committed constraints or dimensions
- **THEN** the deletion is represented as one sketch-local history step
- **AND** one toolbar Undo activation restores both the geometry and the dependent constraints or dimensions
