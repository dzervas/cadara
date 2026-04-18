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

