## ADDED Requirements

### Requirement: Constraint authoring SHALL include automatic snap-derived constraints
The system SHALL allow sketch tools to author constraints derived from accepted snap intent in addition to constraints created through explicit constraint tools.

#### Scenario: Horizontal snap is accepted while drawing a line
- **WHEN** a line drawing operation is accepted with active horizontal snap intent
- **THEN** the committed sketch contribution includes a horizontal constraint for the new line

#### Scenario: Snap intent is cancelled
- **WHEN** the user cancels a drawing operation with active snap intent
- **THEN** no inferred constraint is appended to the durable sketch definition
