## ADDED Requirements

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
