## ADDED Requirements

### Requirement: Dimension authoring SHALL support diameter dimensions for circles and arcs
The system SHALL allow the active sketch Dimension tool to create a driving diameter dimension from one selected local circle or arc entity.

#### Scenario: User dimensions a circle diameter
- **WHEN** the user activates Dimension and selects a local sketch circle
- **THEN** the authoring flow previews a diameter dimension for that circle
- **AND** accepting the authored value commits a durable diameter dimension that references the selected circle entity

#### Scenario: User dimensions an arc diameter
- **WHEN** the user activates Dimension and selects a local sketch arc
- **THEN** the authoring flow previews a diameter dimension for the arc's solved radius
- **AND** accepting the authored value commits a durable diameter dimension that references the selected arc entity

### Requirement: Dimension authoring SHALL support line and vertex distance dimensions
The system SHALL allow the active sketch Dimension tool to create driving distance dimensions between supported sketch-space line and point references.

#### Scenario: User dimensions between parallel sketch lines
- **WHEN** the user activates Dimension and selects two local sketch line segments that are parallel within tolerance
- **THEN** the authoring flow previews the perpendicular distance between the selected line references
- **AND** accepting the authored value commits a durable line-to-line distance dimension that references both selected line entities

#### Scenario: User dimensions between a sketch line and vertex
- **WHEN** the user activates Dimension and selects one local sketch line segment and one local sketch point in either order
- **THEN** the authoring flow previews the perpendicular distance from the point to the line reference
- **AND** accepting the authored value commits a durable line-to-point distance dimension that references the selected line entity and point

#### Scenario: User selects unsupported distance targets
- **WHEN** the Dimension tool receives targets that do not form a supported distance dimension
- **THEN** the sketch definition remains unchanged
- **AND** the authoring flow reports target validation feedback without committing a partial dimension

### Requirement: Dimension authoring SHALL support angle dimensions between non-parallel lines
The system SHALL allow the active sketch Dimension tool to create a driving angle dimension between two non-parallel local sketch line segments.

#### Scenario: User dimensions an angle between two lines
- **WHEN** the user activates Dimension and selects two non-parallel local sketch line segments
- **THEN** the authoring flow previews an angle arc between the selected line references
- **AND** accepting the authored value commits a durable angle dimension that references both selected line entities

#### Scenario: Parallel lines are not angle targets
- **WHEN** the user activates Dimension and selects two local sketch line segments that are parallel within tolerance
- **THEN** the authoring flow does not commit an angle dimension for those targets
- **AND** the targets remain available for the supported line-to-line distance workflow

### Requirement: Dimension authoring SHALL persist annotation placement with durable dimensions
The system SHALL store the user-selected annotation placement for committed dimensions as sketch-plane dimension metadata rather than viewport-only state.

#### Scenario: Linear dimension placement is accepted
- **WHEN** the user drags the pending dimension line for a distance or diameter dimension and accepts the authored value
- **THEN** the committed dimension stores placement metadata sufficient to reproduce the chosen dimension line offset from solved sketch geometry

#### Scenario: Angle dimension placement is accepted
- **WHEN** the user drags the pending angle arc and accepts the authored value
- **THEN** the committed angle dimension stores placement metadata sufficient to reproduce the chosen arc radius and side from solved sketch geometry

#### Scenario: Dimension authoring is cancelled
- **WHEN** the user cancels a pending dimension after changing its annotation placement
- **THEN** the pending value and pending annotation placement are discarded
- **AND** no durable dimension record is appended to the sketch definition
