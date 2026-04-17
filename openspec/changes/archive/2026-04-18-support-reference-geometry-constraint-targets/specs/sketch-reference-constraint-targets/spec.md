## ADDED Requirements

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
