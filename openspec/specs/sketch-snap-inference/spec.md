# sketch-snap-inference Specification

## Purpose
Define how active sketch tools derive deterministic transient snap candidates from editable sketch geometry, projected reference geometry, implicit sketch datum references, and active tool context.
## Requirements
### Requirement: Sketch snap inference SHALL produce deterministic candidates
The system SHALL evaluate local sketch geometry and available projected reference geometry to produce deterministic snap candidates for active sketch tools.

#### Scenario: Pointer is near a line midpoint
- **WHEN** the pointer is within snap tolerance of a supported line midpoint
- **THEN** the snap engine returns a midpoint candidate with the midpoint position and source line reference

#### Scenario: Multiple candidates are available
- **WHEN** multiple snap candidates are within tolerance for the same pointer
- **THEN** the snap engine ranks them deterministically using distance, candidate priority, active-tool context, and stable source identity

### Requirement: Snap inference SHALL include local, projected, and datum geometry
The system SHALL include local editable sketch geometry, read-only projected reference geometry, and implicit sketch datum reference geometry as snap candidate sources when they are available to the active sketch session.

#### Scenario: Pointer is near projected reference geometry
- **WHEN** the active sketch has projected reference geometry and the pointer is within snap tolerance of that geometry
- **THEN** the snap engine can return a projected-reference snap candidate without creating local sketch geometry

#### Scenario: Pointer is near the sketch origin datum
- **WHEN** the pointer is within snap tolerance of the active sketch origin datum point
- **THEN** the snap engine can return a point-like datum-origin snap candidate without creating local sketch geometry

#### Scenario: Pointer is near a sketch datum axis
- **WHEN** the pointer is within snap tolerance of the active sketch X or Y datum axis
- **THEN** the snap engine can return an on-axis datum snap candidate without creating local sketch geometry
- **AND** point-like local or projected candidates at the same location keep precedence over the datum axis guide

### Requirement: Snap inference SHALL not create durable constraints
The snap engine SHALL return transient candidate metadata and snapped coordinates without appending constraints, dimensions, points, or entities to the durable sketch definition.

#### Scenario: User accepts snapped draw point
- **WHEN** a drawing tool accepts a point using a snap candidate
- **THEN** this change commits only the drawing tool's normal geometry contribution
- **AND** no inferred constraint is added by the snap engine
