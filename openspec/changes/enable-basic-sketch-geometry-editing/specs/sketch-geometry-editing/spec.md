## ADDED Requirements

### Requirement: Sketch geometry SHALL be directly selectable for editing
The system SHALL allow users editing a sketch to select existing sketch points or supported sketch geometry handles in the viewport for direct edit operations.

#### Scenario: User selects a sketch point
- **WHEN** the user is editing a sketch and clicks a selectable sketch point without an active drawing or constraint placement conflict
- **THEN** the editor records that sketch point as the active edit target

### Requirement: Under-constrained sketch geometry SHALL support direct drag updates
The system SHALL allow direct drag movement for sketch geometry whose authored constraints do not prevent the requested movement.

#### Scenario: User drags an unconstrained point
- **WHEN** the user drags an unconstrained sketch point to a new sketch-plane position
- **THEN** the sketch draft updates that point position and prepares the corresponding authored sketch mutation

### Requirement: Constrained geometry SHALL move through solver-backed degrees of freedom
The system SHALL use the sketch solver to apply direct drags when constraints define shape relationships but still leave a valid degree of freedom for the requested movement.

#### Scenario: User drags a fully shaped square with free position
- **WHEN** a square is constrained enough to preserve its shape but has no constraints fixing its X and Y position
- **THEN** dragging one vertex moves the entire square through a valid solved translation rather than blocking the edit

### Requirement: Constraint-blocked edits SHALL provide feedback without corrupting the draft
The system SHALL reject, block, or no-op direct edits that cannot satisfy the authored constraints, and SHALL show feedback that the requested movement is constrained.

#### Scenario: User drags immovable constrained geometry
- **WHEN** the user drags sketch geometry whose constraints prevent the requested movement
- **THEN** the editor leaves the authored sketch draft unchanged and shows constrained-movement feedback
