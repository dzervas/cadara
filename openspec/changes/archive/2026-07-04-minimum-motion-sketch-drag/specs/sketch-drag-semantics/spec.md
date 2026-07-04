## ADDED Requirements

### Requirement: Drag intent SHALL be determined by the grabbed handle
The system SHALL derive the drag intent deterministically from the handle the user grabbed, so the same grab always requests the same kind of movement regardless of solver internals.

#### Scenario: User grabs a sketch point
- **WHEN** the user drags a sketch point or entity endpoint
- **THEN** the drag targets only that point
- **AND** connected entities stretch or rotate as their constraints require rather than translating rigidly

#### Scenario: User grabs an entity body
- **WHEN** the user drags the body of a line, arc, or circle away from its defining points
- **THEN** the drag applies an identical translation target to all defining points of that entity

#### Scenario: User grabs a circle or arc rim
- **WHEN** the user drags the rim handle of a circle or arc
- **THEN** the drag targets the radius value
- **AND** the center is not given a drag target by that grab

### Requirement: Non-dragged geometry SHALL move minimally
The system SHALL select drag solutions that keep every non-dragged point as close as possible to its previous accepted frame position, so geometry moves only when a hard constraint forces it and forced motion is minimal.

#### Scenario: Underconstrained sketch has many valid solutions
- **WHEN** a drag solve has multiple valid solutions because the sketch is underconstrained
- **THEN** the accepted solution is the one that minimizes displacement of non-dragged points from their previous accepted frame positions

#### Scenario: Distant unforced geometry stays put
- **WHEN** a point is not connected to the dragged point through any constraint chain that forces movement
- **THEN** its solved position after an accepted drag frame equals its position before the frame

#### Scenario: Constraint-chained geometry follows minimally
- **WHEN** hard constraints force non-dragged geometry to move during a drag
- **THEN** that geometry moves no more than the constraints require

### Requirement: Drag frames SHALL be continuous
The system SHALL produce drag frames continuous with the previous accepted frame and SHALL NOT accept solutions produced by searching reflected or otherwise discontinuous configuration branches during a drag.

#### Scenario: Solver cannot reach the cursor continuously
- **WHEN** no continuous solution reaches the cursor during a drag frame
- **THEN** the sketch keeps the best feasible continuous solution or the last accepted frame
- **AND** no mirrored or branch-searched configuration of the geometry is applied

#### Scenario: Cursor moves far between frames
- **WHEN** the cursor moves farther than the continuity step limit between drag frames
- **THEN** the drag target path is subdivided and solved in bounded substeps from the previous accepted frame

#### Scenario: User deliberately drags through a singular configuration
- **WHEN** the user drags a point continuously through a singular configuration such as a zero-length arrangement
- **THEN** the resulting sign change emerges from the continuous solve
- **AND** it is not produced by discrete branch search
