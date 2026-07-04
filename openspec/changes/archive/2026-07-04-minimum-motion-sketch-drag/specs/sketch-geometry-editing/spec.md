## MODIFIED Requirements

### Requirement: Constrained geometry SHALL move through solver-backed degrees of freedom
The system SHALL use the sketch solver to apply direct drags when constraints define shape relationships but still leave a valid degree of freedom, moving the dragged target as close to the pointer as the constraints allow instead of blocking the edit.

#### Scenario: User drags a fully shaped square with free position
- **WHEN** a square is constrained enough to preserve its shape but has no constraints fixing its X and Y position
- **THEN** dragging one vertex moves the entire square through a valid solved translation rather than blocking the edit

#### Scenario: User drags a point that can only slide
- **WHEN** the user drags a sketch point whose constraints restrict it to a curve or direction, toward a pointer position off that feasible set
- **THEN** the point slides to the feasible position closest to the pointer
- **AND** the drag is not blocked or refused

#### Scenario: Drag lags behind an aggressive pointer
- **WHEN** the pointer requests movement the constraints only partially allow during a drag frame
- **THEN** the sketch updates to the best feasible solved state for that frame
- **AND** the geometry visibly lags or slides rather than snapping to an invalid or discontinuous configuration

### Requirement: Constraint-blocked edits SHALL provide feedback without corrupting the draft
The system SHALL no-op direct drags on fully constrained geometry and non-convergent drag frames while showing constrained-movement feedback, and SHALL NOT report movement as blocked merely because the pointer position is not exactly reachable.

#### Scenario: User drags fully constrained geometry
- **WHEN** the user drags sketch geometry whose component has no free degrees of freedom
- **THEN** the editor leaves the authored sketch draft unchanged and shows constrained-movement feedback derived from the constrained state of the target

#### Scenario: Drag frame does not converge
- **WHEN** an interactive drag frame is non-convergent
- **THEN** the editor keeps the last accepted solved state and shows constrained-movement feedback
- **AND** the authored sketch draft is not corrupted by unconverged geometry

#### Scenario: Partially constrained target shows no blocking feedback
- **WHEN** the user drags a partially constrained target that slides along its remaining degrees of freedom
- **THEN** the editor treats the drag as successful movement
- **AND** it does not show constrained-movement feedback for the reachable-limit lag
