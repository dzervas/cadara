# sketch-inferred-constraint-authoring Specification

## Purpose
Define how accepted sketch snaps become durable inferred constraints when preserving the user's intended relationship matters after later edits.
## Requirements
### Requirement: Accepted snaps SHALL author durable inferred constraints
The system SHALL convert supported accepted snap candidates into durable sketch constraints that preserve the intended geometric relationship after later edits.

#### Scenario: User accepts midpoint snap
- **WHEN** the user places a sketch point by accepting a midpoint snap on a line
- **THEN** the sketch commits a durable midpoint relationship involving the placed point and source line
- **AND** the relationship is solver-owned rather than stored only as the point's initial coordinates

#### Scenario: User accepts point-on-line snap
- **WHEN** the user places a sketch point by accepting a snap onto a line
- **THEN** the sketch commits a durable point-on-line relationship for the placed point and source line

#### Scenario: User accepts sketch datum origin snap
- **WHEN** the user places a sketch point by accepting a snap to the active sketch origin datum
- **THEN** the sketch commits a durable coincident relationship between the placed point and the sketch datum origin
- **AND** the relationship references the datum operand rather than a generated local proxy point

#### Scenario: User accepts sketch datum axis snap
- **WHEN** the user places a sketch point by accepting a snap onto the active sketch X or Y datum axis
- **THEN** the sketch commits a durable point-on-curve relationship between the placed point and the sketch datum axis
- **AND** the relationship references the datum operand rather than a generated local proxy line

### Requirement: Inferred constraints SHALL be previewed before commit
The system SHALL show transient feedback for the constraint relationship that will be authored if the active snap is accepted.

#### Scenario: Tangent snap is active
- **WHEN** the active snap candidate would create a tangent relationship on accept
- **THEN** the viewport shows transient tangent intent feedback before any durable constraint is committed

### Requirement: Inferred constraints SHALL preserve sketch undo semantics
The system SHALL treat inferred constraints as part of the sketch authoring action that accepted the snap when the user experiences them as one operation.

#### Scenario: User undoes snapped line creation
- **WHEN** a line creation accepted snap candidates that authored inferred constraints
- **THEN** Undo removes or hides the line and its inferred constraints together according to the sketch-local history cursor
