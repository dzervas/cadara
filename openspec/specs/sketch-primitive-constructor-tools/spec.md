# sketch-primitive-constructor-tools Specification

## Purpose
TBD - created by archiving change add-sketch-primitive-constructors. Update Purpose after archive.
## Requirements
### Requirement: Primitive constructor tools SHALL be available in sketch mode
The system SHALL expose sketch-mode constructor tools for point, midpoint line, center-point rectangle, aligned rectangle, 3-point circle, 3-point arc, tangent arc, center-point arc, inscribed polygon, and circumscribed polygon.

#### Scenario: User activates a primitive constructor
- **WHEN** the user activates one of the primitive constructor tools while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the tool enters its expected staged authoring workflow

### Requirement: Primitive constructors SHALL commit durable sketch geometry
Primitive constructor tools SHALL commit durable sketch points, line segments, circles, and arcs using the existing authored sketch entity contract.

#### Scenario: Constructor is completed
- **WHEN** the user completes a valid primitive constructor interaction
- **THEN** the sketch definition includes the authored points and entities produced by that constructor
- **AND** the sketch commit request includes the same durable geometry

#### Scenario: Constructor input is invalid
- **WHEN** the user attempts to complete a constructor with degenerate or insufficient input
- **THEN** the editor keeps the sketch session active
- **AND** the sketch definition is not mutated by a partial constructor result

### Requirement: Constructor intent SHALL be preserved with durable constraints
The system SHALL author durable constraints and dimensions required to preserve the geometric intent of constructor variants after later edits.

#### Scenario: Midpoint line is committed
- **WHEN** the user creates a midpoint line by selecting a midpoint and an endpoint
- **THEN** the sketch contains a line whose endpoints are symmetric about the selected midpoint
- **AND** the midpoint relationship is represented as durable solver-owned sketch intent

#### Scenario: Center-point rectangle is committed
- **WHEN** the user creates a center-point rectangle
- **THEN** the rectangle edges and corners are committed as durable sketch geometry
- **AND** the center relationship is preserved by durable constraints rather than only by initial point coordinates

#### Scenario: Aligned rectangle is committed
- **WHEN** the user creates an aligned rectangle from three points
- **THEN** the rectangle orientation follows the first edge
- **AND** parallel/perpendicular/equal-length relationships preserve rectangle intent without forcing horizontal or vertical alignment

### Requirement: Arc and circle variants SHALL preserve defining relationships
Circle and arc constructor variants SHALL preserve the authored relationships implied by their input points and tangent references.

#### Scenario: 3-point circle is committed
- **WHEN** the user creates a circle from three non-collinear points
- **THEN** the committed circle passes through the selected points through durable authored relationships

#### Scenario: Tangent arc is committed
- **WHEN** the user creates a tangent arc from a supported tangent source
- **THEN** the committed arc includes durable tangent intent to the source curve

### Requirement: Polygon constructors SHALL create constrained line-loop geometry
Inscribed and circumscribed polygon tools SHALL create durable line-loop geometry with constraints that preserve regular polygon intent where supported.

#### Scenario: Inscribed polygon is committed
- **WHEN** the user creates an inscribed polygon
- **THEN** the sketch contains a closed loop of line segments whose vertices lie on the authored construction circle relationship

#### Scenario: Circumscribed polygon is committed
- **WHEN** the user creates a circumscribed polygon
- **THEN** the sketch contains a closed loop of line segments whose sides are tangent to the authored construction circle relationship

