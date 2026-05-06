## ADDED Requirements

### Requirement: Point constructor SHALL be reachable and commit standalone points
The system SHALL expose the Point constructor as a reachable sketch-mode drawing tool and SHALL commit each accepted placement as standalone durable sketch point geometry.

#### Scenario: User creates a standalone point
- **WHEN** the user activates Point while editing a sketch and clicks a valid sketch-plane location
- **THEN** the active sketch session remains open
- **AND** the sketch definition includes a durable point record and point entity for that location
- **AND** the sketch commit request includes the same durable point geometry

#### Scenario: User places multiple points
- **WHEN** the Point tool remains active and the user accepts multiple valid placements
- **THEN** each placement appends a separate durable sketch point
- **AND** previously placed points remain selectable and editable

### Requirement: Standalone points SHALL participate in sketch editor operations
Standalone points authored by the Point constructor SHALL participate in selection, snapping, deletion, persistence, solving, and supported constraint authoring like other editable sketch points.

#### Scenario: User constrains a standalone point
- **WHEN** a standalone point created by the Point tool is selected by a supported constraint tool
- **THEN** the constraint authoring flow resolves it as an editable local point target

#### Scenario: User deletes a standalone point
- **WHEN** the user deletes a selected standalone point from an active sketch
- **THEN** the point geometry is removed from the sketch definition
- **AND** constraints or dimensions that reference that point are removed through the existing dependency cleanup behavior
