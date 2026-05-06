## ADDED Requirements

### Requirement: Sketch solver SHALL evaluate collinear constraints
The sketch solver SHALL evaluate durable collinear constraints as solver-owned line-equation terms for supported local point, local line, projected line, and datum line operands.

#### Scenario: Local line-to-line collinear constraint solves
- **WHEN** the authored sketch contains a collinear relationship between two non-degenerate local line segments
- **THEN** the solver keeps the driven line endpoints on the reference line's infinite geometry within tolerance
- **AND** the constraint status reports satisfied when the relationship is solved

#### Scenario: Local point-to-line collinear constraint solves
- **WHEN** the authored sketch contains a collinear relationship between an editable local point and a non-degenerate line
- **THEN** the solver keeps the point on the line's infinite geometry within tolerance
- **AND** the constraint status reports satisfied when the relationship is solved

#### Scenario: Projected line collinear constraint solves
- **WHEN** the authored sketch contains a collinear relationship between an editable local target and a projected line reference
- **THEN** the solver uses the projected line as read-only input
- **AND** it moves only editable local sketch geometry to satisfy the relationship

### Requirement: Sketch solver SHALL diagnose invalid collinear constraints
The sketch solver SHALL report invalid or unsatisfied diagnostics for collinear constraints with missing operands, unsupported operand kinds, or degenerate reference lines.

#### Scenario: Collinear target is missing
- **WHEN** a collinear constraint references a point, entity, projected reference, or datum line that is unavailable in the solve request
- **THEN** the solver reports the constraint as invalid or unsatisfied
- **AND** it does not invent fallback geometry

#### Scenario: Collinear reference is degenerate
- **WHEN** a collinear constraint uses a line operand whose endpoints are coincident within tolerance
- **THEN** the solver reports an invalid or unsatisfied diagnostic for that constraint
- **AND** it does not normalize the line to an arbitrary direction
