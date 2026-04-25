## MODIFIED Requirements

### Requirement: Dimension authoring SHALL support value entry for angle dimensions between non-parallel lines
The system SHALL treat two non-parallel line targets selected with the Dimension tool as an angular dimension workflow from preview through durable commit.

#### Scenario: User places an angle dimension from non-parallel lines
- **WHEN** the user activates Dimension and selects two non-parallel local sketch line segments
- **THEN** the authoring flow previews an angle arc between the selected line references
- **AND** the next primary viewport click pins the angle annotation placement and opens the floating value-entry prompt
- **AND** the prompt is labeled as an angle value rather than a distance value

#### Scenario: User commits an angle dimension value
- **WHEN** an angle dimension value-entry prompt is open after two non-parallel line targets are selected
- **AND** the user enters a value in degrees and accepts it
- **THEN** the durable sketch definition stores a `lineAngle` dimension for the selected lines
- **AND** the stored `valueRadians` matches the entered degree value converted to radians

#### Scenario: User edits a committed angle dimension annotation
- **WHEN** the user reopens a committed line angle dimension annotation
- **THEN** the floating value-entry prompt is seeded with the current angle in degrees
- **AND** accepting the edit updates the durable `valueRadians` field after converting the entered degrees to radians

## ADDED Requirements

### Requirement: Dimension authoring SHALL support line length dimensions from a single edge
The system SHALL allow the active sketch Dimension tool to create a driving line-length dimension from one selected local sketch line segment.

#### Scenario: User dimensions a line segment length
- **WHEN** the user activates Dimension and selects one local sketch line segment
- **THEN** the authoring flow previews a line-length dimension for that edge
- **AND** a primary viewport click away from selecting a second dimension target opens the floating value-entry prompt
- **AND** accepting the authored value commits a durable line-length dimension that references the selected line entity

#### Scenario: User continues from one line to a two-target dimension
- **WHEN** the user activates Dimension and selects one local sketch line segment
- **AND** the user next selects another supported dimension target before pinning value placement
- **THEN** the authoring flow uses the two selected targets for the supported line distance, line-point distance, or line angle workflow

### Requirement: Dimension annotations SHALL avoid deprecated directional labels
The system SHALL keep committed dimension visible text compact and SHALL avoid exposing deprecated internal directional labels as user-facing annotation detail.

#### Scenario: Committed distance dimension metadata is displayed
- **WHEN** the viewport renders a committed distance, horizontal distance, vertical distance, line distance, or point-line distance dimension
- **THEN** the visible annotation chip shows only the compact numeric value
- **AND** accessible detail text uses current measurement wording such as distance and units
- **AND** accessible detail text does not expose internal role labels such as aligned, horizontal, or vertical as the measurement type

#### Scenario: Committed angle dimension metadata is displayed
- **WHEN** the viewport renders a committed line angle dimension
- **THEN** the visible annotation chip shows the angle value in degrees
- **AND** the annotation glyph and accessible detail identify the annotation as an angle dimension
