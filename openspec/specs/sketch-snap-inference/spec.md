# sketch-snap-inference Specification

## Purpose
TBD - created by archiving change add-sketch-snap-candidate-engine. Update Purpose after archive.
## Requirements
### Requirement: Sketch snap inference SHALL produce deterministic candidates
The system SHALL evaluate local sketch geometry and available projected reference geometry to produce deterministic snap candidates for active sketch tools.

#### Scenario: Pointer is near a line midpoint
- **WHEN** the pointer is within snap tolerance of a supported line midpoint
- **THEN** the snap engine returns a midpoint candidate with the midpoint position and source line reference

#### Scenario: Multiple candidates are available
- **WHEN** multiple snap candidates are within tolerance for the same pointer
- **THEN** the snap engine ranks them deterministically using distance, candidate priority, active-tool context, and stable source identity

### Requirement: Snap inference SHALL include local and projected geometry
The system SHALL include both local editable sketch geometry and read-only projected reference geometry as snap candidate sources when they are available to the active sketch session.

#### Scenario: Pointer is near projected reference geometry
- **WHEN** the active sketch has projected reference geometry and the pointer is within snap tolerance of that geometry
- **THEN** the snap engine can return a projected-reference snap candidate without creating local sketch geometry

### Requirement: Snap inference SHALL not create durable constraints
The snap engine SHALL return transient candidate metadata and snapped coordinates without appending constraints, dimensions, points, or entities to the durable sketch definition.

#### Scenario: User accepts snapped draw point
- **WHEN** a drawing tool accepts a point using a snap candidate
- **THEN** this change commits only the drawing tool's normal geometry contribution
- **AND** no inferred constraint is added by the snap engine

