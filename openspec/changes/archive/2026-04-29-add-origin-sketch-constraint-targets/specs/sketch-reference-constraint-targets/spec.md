## ADDED Requirements

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
