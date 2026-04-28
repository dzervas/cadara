## ADDED Requirements

### Requirement: Bound reference-image anchors SHALL remain ordinary sketch constraint targets
Any local sketch point bound to a reference-image anchor SHALL remain an ordinary sketch point target for the existing constraint and dimension authoring workflows after calibration mode exits.

#### Scenario: User constrains a bound image anchor point
- **WHEN** the user selects a local sketch point that is bound to a reference-image anchor while using a supported constraint or dimension tool
- **THEN** the authoring workflow accepts that point using the same target validation rules as any other local sketch point
- **AND** committing the constraint or dimension updates the flat sketch graph without entering a special image-calibration workflow

### Requirement: Constraint authoring SHALL NOT expose calibration-only constraint tools
The sketch constraint authoring surface SHALL NOT provide a dedicated reference-image-only constraint flow for horizontal, vertical, distance, or similar geometric relationships between bound image anchors.

#### Scenario: User wants to dimension between image anchors
- **WHEN** the user needs a geometric relationship between two bound reference-image anchor points
- **THEN** the editor uses the existing sketch constraint or dimension tools for that relationship
- **AND** the editor does not expose a separate calibration-only distance-constraint command for those anchors
