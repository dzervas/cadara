## MODIFIED Requirements

### Requirement: Sketch transform operators SHALL be available in sketch mode
The system SHALL expose sketch-mode mirror, linear pattern, circular pattern, transform, and offset operators while keeping them distinct from part-mode feature tools with similar names.

#### Scenario: User activates sketch mirror
- **WHEN** the user activates Mirror while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the editor enters a sketch-local mirror selection and preview workflow

#### Scenario: User activates sketch pattern or transform
- **WHEN** the user activates Linear Pattern, Circular Pattern, or Transform while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the editor enters the selected operator's sketch-local workflow

#### Scenario: User activates sketch offset
- **WHEN** the user activates Offset while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the editor enters a chain selection and side/distance preview workflow

### Requirement: Derived sketch operators SHALL create durable referenced relationships
Sketch mirror, pattern, transform, and offset operators MUST create durable referenced and related geometry rather than one-time static copies.

#### Scenario: Mirror relationship is committed
- **WHEN** the user mirrors supported sketch geometry across a supported sketch reference
- **THEN** the sketch definition preserves the selected seed geometry, mirror reference, and derived mirrored geometry relationship

#### Scenario: Pattern relationship is committed
- **WHEN** the user creates a supported linear or circular pattern from selected sketch geometry
- **THEN** the sketch definition preserves the selected seed geometry, pattern parameters, and derived instance relationships

#### Scenario: Transform relationship is committed
- **WHEN** the user transforms supported sketch geometry with valid transform parameters
- **THEN** the sketch definition preserves the selected seed geometry, transform parameters, and derived transformed geometry relationship

#### Scenario: Offset relationship is committed
- **WHEN** the user offsets a supported connected chain of sketch geometry by a valid distance
- **THEN** the sketch definition preserves the seed chain, the signed offset distance, the joint policy, and the derived offset geometry relationship with stable output identities

## ADDED Requirements

### Requirement: Offset derivation SHALL support the sketch curve vocabulary with explicit accuracy semantics
The offset derivation SHALL offset lines, circles, and arcs in closed form and SHALL offset splines and bezier curves by tolerance-bounded approximation.

#### Scenario: Analytic curves are offset exactly
- **WHEN** a seed chain contains lines, arcs, or circles
- **THEN** the derived outputs are exact offsets (translated lines, radius-adjusted arcs and circles) of the same entity kinds

#### Scenario: Spline is offset within tolerance
- **WHEN** a seed chain contains a spline or bezier curve
- **THEN** the derived output is a spline whose deviation from the true offset stays within the documented tolerance
- **AND** the approximation failing to meet tolerance within bounded refinement produces a structured diagnostic rather than an out-of-tolerance result

#### Scenario: Unsupported seed kind is selected
- **WHEN** the selection includes an entity kind the offset derivation does not support
- **THEN** the operator reports the unsupported target before mutation
- **AND** no partial relationship is committed

### Requirement: Offset joints SHALL be resolved deterministically
Adjacent derived segments SHALL be joined by trimming or extending to their intersection, and by an arc join centered on the shared seed vertex when no intersection exists on the offset side.

#### Scenario: Neighboring offsets intersect
- **WHEN** two adjacent seed entities produce offset segments that intersect on the offset side
- **THEN** both derived segments are trimmed or extended to the intersection point

#### Scenario: Neighboring offsets do not intersect
- **WHEN** two adjacent seed entities produce offset segments with no intersection on the offset side
- **THEN** a joint arc centered on the shared seed vertex with radius equal to the offset distance connects the derived segments
- **AND** the joint arc has a stable derived identity tied to the adjacent seed pair

### Requirement: Offset distance SHALL be dimensionable and expression-capable
The offset distance SHALL behave as a sketch dimension: editable numerically, bindable to expressions and document variables, and driving associative recompute of the derived chain.

#### Scenario: Distance expression changes
- **WHEN** the user edits the offset distance to an expression referencing a document variable and the variable's value changes
- **THEN** the derived offset chain recomputes to the new evaluated distance

#### Scenario: Distance makes a segment degenerate
- **WHEN** the evaluated distance collapses an arc segment (distance not smaller than the arc radius on the shrinking side) or otherwise makes the chain unsatisfiable
- **THEN** the system reports a structured diagnostic identifying the failing segment
- **AND** the relationship is not silently detached into static geometry
