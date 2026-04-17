## ADDED Requirements

### Requirement: Constraint authoring SHALL collect projected reference targets
The system SHALL allow explicit constraint tools to collect projected reference geometry targets when the active operation supports the projected geometry kind.

#### Scenario: Constraint tool accepts projected line
- **WHEN** a line relationship constraint tool is active and the user selects projected line geometry
- **THEN** the constraint authoring state records the projected line as a valid target for that operation

#### Scenario: Constraint tool rejects unsupported projected geometry
- **WHEN** the active constraint operation does not support the hovered projected geometry kind
- **THEN** the editor rejects the target using the existing selection feedback path
- **AND** no durable constraint is committed
