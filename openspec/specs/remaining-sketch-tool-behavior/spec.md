# remaining-sketch-tool-behavior Specification

## Purpose
TBD - created by archiving change implement-remaining-sketch-tool-behavior. Update Purpose after archive.
## Requirements
### Requirement: Primary Dimension SHALL activate default distance dimension authoring
The system SHALL treat the primary `dimension` sketch toolbar command as the default aligned distance dimension workflow while preserving the existing dimension variant commands.

#### Scenario: User activates primary dimension
- **WHEN** the user activates `dimension` while editing a sketch
- **THEN** the editor enters the same target-picking behavior as the aligned distance dimension tool
- **AND** the active sketch session remains open

### Requirement: Spline SHALL author durable sketch spline geometry
The system SHALL allow users editing a sketch to create spline geometry through the `spline` tool with live preview, validation, and durable sketch commit behavior.

#### Scenario: User completes a spline
- **WHEN** the user places the minimum valid spline points and accepts the tool interaction
- **THEN** the sketch draft contains a durable spline entity and the points required to define it
- **AND** the commit request includes that spline geometry

#### Scenario: User attempts an invalid spline
- **WHEN** the user attempts to complete a spline without enough valid points
- **THEN** the editor keeps the sketch session active and reports validation feedback without committing a partial spline

### Requirement: Trim SHALL remove supported curve segments from active sketches
The system SHALL allow users editing a sketch to trim supported local sketch curve segments at valid intersections without corrupting unrelated sketch entities.

#### Scenario: User trims a line segment
- **WHEN** the user activates `trim` and selects a supported segment portion bounded by valid intersections
- **THEN** the sketch draft removes or splits only the selected portion
- **AND** the remaining geometry keeps stable authored references where possible

#### Scenario: Trim target is unsupported
- **WHEN** the user selects a target that cannot be trimmed safely
- **THEN** the editor leaves the sketch draft unchanged and reports validation feedback

### Requirement: Offset SHALL create supported offset sketch geometry
The system SHALL allow users editing a sketch to create offset copies of supported sketch entities using an authored distance and side selection.

#### Scenario: User offsets a supported entity
- **WHEN** the user activates `offset`, selects a supported sketch entity, and accepts a valid offset distance
- **THEN** the sketch draft adds offset geometry at the requested distance
- **AND** the original entity remains unchanged

#### Scenario: Offset distance is invalid
- **WHEN** the requested offset distance would create invalid or unsupported geometry
- **THEN** the editor keeps the sketch draft unchanged and reports validation feedback

