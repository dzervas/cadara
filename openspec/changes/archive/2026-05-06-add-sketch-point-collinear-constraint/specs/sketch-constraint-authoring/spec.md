## ADDED Requirements

### Requirement: Constraint authoring SHALL include Collinear
The system SHALL include Collinear in first-class sketch constraint authoring with staged target collection, preview feedback, durable mutation, annotation display, and solver separation.

#### Scenario: Collinear collects targets while active
- **WHEN** the user activates Collinear and clicks valid sketch point, local line, or projected line targets
- **THEN** the active constraint authoring state records the clicked targets in selection order
- **AND** no durable constraint is committed until the target set is valid and accepted

#### Scenario: Collinear commits through modeling boundary
- **WHEN** the active Collinear workflow accepts a valid target set
- **THEN** the frontend routes a durable sketch mutation through the existing modeling boundary
- **AND** the authoritative sketch document stores the committed collinear constraints

### Requirement: Collinear SHALL support ordered multi-target authoring
The Collinear authoring workflow SHALL preserve selection order so the first selected line-compatible reference defines the underlying line for later editable targets.

#### Scenario: User selects line then point then line
- **WHEN** Collinear is active and the user selects a valid line, then an editable point, then an editable line
- **THEN** the authoring state treats the first line as the reference
- **AND** it prepares collinear relationships from each later editable target to that reference

#### Scenario: User starts with point then line
- **WHEN** Collinear is active and the user selects an editable point followed by a valid line
- **THEN** the authoring state can form a point-to-line collinear relationship
- **AND** it does not require the user to reselect the targets in line-first order
