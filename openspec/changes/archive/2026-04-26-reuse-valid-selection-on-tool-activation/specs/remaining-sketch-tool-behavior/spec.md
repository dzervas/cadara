## MODIFIED Requirements

### Requirement: Offset SHALL create supported offset sketch geometry
The system SHALL allow users editing a sketch to create offset copies of one or more supported sketch entities using an authored distance and side selection. When `offset` activates, the system SHALL reuse a compatible current selection and SHALL clear an incompatible one.

#### Scenario: User offsets a supported entity
- **WHEN** the user activates `offset`, selects a supported sketch entity, and accepts a valid offset distance
- **THEN** the sketch draft adds offset geometry at the requested distance
- **AND** the original entity remains unchanged

#### Scenario: User offsets compatible preselected entities
- **WHEN** the user selects one or more supported sketch entities, activates `offset`, and accepts a valid offset distance
- **THEN** the sketch draft adds offset geometry for each accepted selected entity
- **AND** the original selected entities remain unchanged

#### Scenario: Incompatible offset preselection is cleared
- **WHEN** the user activates `offset` while the current selection contains unsupported or mixed incompatible targets
- **THEN** the editor clears the current selection
- **AND** the offset workflow waits for new compatible target selections

#### Scenario: Offset distance is invalid
- **WHEN** the requested offset distance would create invalid or unsupported geometry
- **THEN** the editor keeps the sketch draft unchanged and reports validation feedback
