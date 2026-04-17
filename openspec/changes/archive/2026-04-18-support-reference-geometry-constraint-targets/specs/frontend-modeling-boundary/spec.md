## ADDED Requirements

### Requirement: Reference-targeted constraint mutations SHALL use the modeling boundary
The system SHALL route accepted durable constraints that target projected reference geometry through the frontend-facing modeling boundary.

#### Scenario: User commits reference-targeted constraint
- **WHEN** the editor accepts a constraint operation involving projected reference geometry
- **THEN** the durable mutation is issued through the modeling boundary
- **AND** the viewport does not directly mutate sketch constraint records
