## ADDED Requirements

### Requirement: Sketch solver SHALL evaluate expanded driving dimension kinds
The sketch solver SHALL evaluate durable diameter, line-to-line distance, line-to-point distance, and line-to-line angle dimensions as solver-owned driving dimension terms.

#### Scenario: Diameter dimension drives a circle
- **WHEN** the authored sketch contains a diameter dimension for a supported circle entity
- **THEN** the solver treats half of the authored diameter value as the target solved radius
- **AND** the solved dimension status reports the diameter value represented by the solved circle

#### Scenario: Diameter dimension drives an arc
- **WHEN** the authored sketch contains a diameter dimension for a supported arc entity
- **THEN** the solver treats half of the authored diameter value as the target solved arc radius
- **AND** the solved dimension status reports the diameter value represented by the solved arc

#### Scenario: Line-to-line distance dimension drives parallel lines
- **WHEN** the authored sketch contains a line-to-line distance dimension between two supported parallel line entities
- **THEN** the solver drives the perpendicular separation between the solved line references to the authored value within tolerance
- **AND** the solved dimension status reports the solved perpendicular distance

#### Scenario: Line-to-point distance dimension drives a point
- **WHEN** the authored sketch contains a line-to-point distance dimension between a supported line entity and point
- **THEN** the solver drives the point's perpendicular distance from the solved line reference to the authored value within tolerance
- **AND** the solved dimension status reports the solved perpendicular distance

#### Scenario: Angle dimension drives non-parallel lines
- **WHEN** the authored sketch contains an angle dimension between two supported non-parallel line entities
- **THEN** the solver drives the signed or selected-angle relationship between the solved line references to the authored angle value within tolerance
- **AND** the solved dimension status reports the solved angle value

### Requirement: Sketch solver SHALL report invalid expanded dimensions without fallback geometry
The sketch solver SHALL reject expanded dimension records that reference missing, unsupported, degenerate, or incompatible geometry without inventing replacement targets.

#### Scenario: Dimension target is missing
- **WHEN** an expanded dimension references a point or entity that is absent from the sketch definition
- **THEN** the solver reports the dimension as unsatisfied or invalid
- **AND** it does not create fallback points, lines, arcs, or circles

#### Scenario: Line-to-line distance uses non-parallel lines
- **WHEN** a line-to-line distance dimension references two non-parallel line entities
- **THEN** the solver reports the dimension as unsatisfied or invalid
- **AND** it does not reinterpret the record as an angle dimension

#### Scenario: Angle dimension uses parallel or degenerate lines
- **WHEN** an angle dimension references parallel or degenerate line entities
- **THEN** the solver reports the dimension as unsatisfied or invalid
- **AND** it does not synthesize an arbitrary angle
