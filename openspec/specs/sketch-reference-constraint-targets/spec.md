# sketch-reference-constraint-targets Specification

## Purpose
TBD - created by archiving change support-reference-geometry-constraint-targets. Update Purpose after archive.
## Requirements
### Requirement: Constraints SHALL support projected reference geometry operands
The system SHALL provide durable constraint operands that can identify local sketch geometry and projected reference geometry without copying projected geometry into the local sketch graph.

#### Scenario: Constraint targets projected point geometry
- **WHEN** the user commits a supported constraint between a local sketch point and projected point geometry
- **THEN** the durable constraint stores a projected geometry operand keyed by reference ID and projected geometry ID

#### Scenario: Referenced projection becomes invalid
- **WHEN** a constraint targets projected geometry that is missing or no longer valid for the active revision
- **THEN** the authored constraint remains in the sketch definition
- **AND** the solve result reports machine-readable diagnostics for the invalid projected target

### Requirement: Local sketch geometry SHALL constrain against projected reference curves
The system SHALL solve supported local-to-reference relationships using projected reference geometry as read-only solver input.

#### Scenario: Local point is constrained to projected line
- **WHEN** a local sketch point has a point-on-projected-line constraint
- **THEN** the solver moves local sketch degrees of freedom to place the point on the projected line when the system is satisfiable

#### Scenario: Local line is constrained perpendicular to projected line
- **WHEN** a local line has a perpendicular relationship to projected line geometry
- **THEN** the solver treats the projected line as fixed input and solves the local line orientation accordingly

### Requirement: Reference-targeted annotations SHALL remain selectable
The system SHALL render committed reference-targeted constraints as selectable annotations derived from durable constraint records and active projected geometry.

#### Scenario: User selects reference-targeted constraint annotation
- **WHEN** the user selects an annotation for a constraint involving projected reference geometry
- **THEN** the editor selects the durable constraint target
- **AND** the viewport highlights the affected local and projected geometry

### Requirement: Constraint authoring SHALL use live projected reference targets
The system SHALL allow supported constraint tools to target projected reference geometry produced from authored external references in the active sketch session.

#### Scenario: Constraint targets a live projected point
- **WHEN** the user authors a supported constraint between local sketch geometry and a visible projected point reference
- **THEN** the durable constraint stores a projected geometry operand keyed by reference ID and projected geometry ID
- **AND** no local sketch point is created to stand in for the projected point

#### Scenario: Constraint targets a live projected curve
- **WHEN** the user authors a supported point-on, perpendicular, parallel, tangent, or equal relationship against a visible projected line, circle, or arc where that relationship is supported
- **THEN** the durable constraint stores the projected curve operand and the local operand
- **AND** the projected curve remains read-only solver input

### Requirement: Constraint solving SHALL evaluate projected operands from active projection records
The system SHALL validate and solve reference-targeted constraints against the projected reference records for the active document revision.

#### Scenario: Projected constraint operand resolves
- **WHEN** a sketch solve includes a constraint targeting projected reference geometry that exists in the active projection records
- **THEN** the solver treats the projected geometry as fixed input
- **AND** it moves only local sketch degrees of freedom when the system is satisfiable

#### Scenario: Projected constraint operand is invalid
- **WHEN** a sketch solve includes a constraint targeting projected reference geometry that is missing, stale, or no longer compatible with the stored projected geometry kind
- **THEN** validation or solve returns machine-readable diagnostics for the invalid projected operand
- **AND** the authored constraint remains in the sketch definition for repair or deletion by the user

### Requirement: Durable constraint targets SHALL support implicit sketch datum operands
The system SHALL allow committed sketch constraints and dimensions to reference the active sketch origin point and sketch-local X or Y axes through stable datum target identities rather than through local proxy geometry.

#### Scenario: Committed record targets the sketch origin
- **WHEN** the user commits a supported constraint or dimension between editable local sketch geometry and the sketch origin datum point
- **THEN** the durable record stores a stable datum-point operand for the origin
- **AND** that record does not depend on a user-authored sketch point created only to represent the origin

#### Scenario: Committed record targets a sketch datum axis
- **WHEN** the user commits a supported constraint or dimension between editable local sketch geometry and the sketch-local X axis or Y axis
- **THEN** the durable record stores a stable datum-axis operand for the selected axis
- **AND** that record does not depend on a user-authored construction line created only to represent the axis

### Requirement: Datum-targeted solving SHALL resolve from the sketch plane frame
The system SHALL resolve origin and axis datum operands from the owning sketch plane frame and treat them as fixed read-only solve inputs.

#### Scenario: Local point is constrained to the sketch origin
- **WHEN** a sketch solve includes a supported origin-targeted constraint
- **THEN** the solver resolves the origin as sketch coordinates `[0, 0]`
- **AND** it moves only local editable sketch degrees of freedom when the system is satisfiable

#### Scenario: Local geometry is constrained to a sketch datum axis on a rotated sketch plane
- **WHEN** a sketch solve includes a supported constraint or dimension that references the sketch-local X axis or Y axis for a sketch whose support plane is not world-XY aligned
- **THEN** the solver resolves that axis from the sketch plane's local coordinate frame
- **AND** it does not reinterpret the datum axis against world-space X or Y

### Requirement: Datum-targeted annotations SHALL remain selectable
The system SHALL render committed origin-targeted and axis-targeted constraints or dimensions as selectable annotations derived from durable records and the active sketch datum references.

#### Scenario: User selects an origin-targeted annotation
- **WHEN** the user clicks a committed constraint or dimension annotation that references the sketch origin datum point
- **THEN** the editor selects the durable authored record
- **AND** the viewport highlights the affected editable geometry together with the origin datum point

#### Scenario: User selects an axis-targeted annotation
- **WHEN** the user clicks a committed constraint or dimension annotation that references the sketch-local X axis or Y axis
- **THEN** the editor selects the durable authored record
- **AND** the viewport highlights the affected editable geometry together with the referenced datum axis

### Requirement: Invalid datum operands SHALL preserve authored records with diagnostics
The system SHALL preserve datum-targeted constraints and dimensions when the owning sketch plane data cannot be resolved, and it SHALL surface machine-readable diagnostics for repair.

#### Scenario: Sketch plane metadata needed for datum resolution is invalid
- **WHEN** a sketch solve or validation pass encounters a committed datum-targeted record whose owning sketch plane frame cannot be resolved
- **THEN** the authored record remains present in the sketch definition
- **AND** the solve or validation result reports machine-readable diagnostics for the invalid datum target

