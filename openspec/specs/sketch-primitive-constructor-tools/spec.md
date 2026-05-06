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

