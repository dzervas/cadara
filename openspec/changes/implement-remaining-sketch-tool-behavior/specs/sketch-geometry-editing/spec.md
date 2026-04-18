## ADDED Requirements

### Requirement: Active sketch editing SHALL support trim mutations
The system SHALL include Trim as an active sketch edit operation that can mutate supported authored sketch entities while preserving sketch editing state.

#### Scenario: Trim mutation is accepted
- **WHEN** a valid trim operation is accepted
- **THEN** the authored sketch draft changes through sketch-session domain logic
- **AND** the active sketch session remains open for further editing

### Requirement: Active sketch editing SHALL support offset mutations
The system SHALL include Offset as an active sketch edit operation that can add supported offset geometry while preserving sketch editing state.

#### Scenario: Offset mutation is accepted
- **WHEN** a valid offset operation is accepted
- **THEN** the authored sketch draft adds the offset geometry through sketch-session domain logic
- **AND** the active sketch session remains open for further editing
