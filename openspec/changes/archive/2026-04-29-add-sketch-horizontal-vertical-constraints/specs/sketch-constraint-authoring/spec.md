## ADDED Requirements

### Requirement: Constraint authoring SHALL support explicit horizontal and vertical line constraints
The system SHALL allow explicit sketch constraint tools to author durable horizontal and vertical line-orientation constraints for editable local line segments.

#### Scenario: User constrains a line horizontal
- **WHEN** the user activates the Horizontal constraint tool and selects an editable local line segment
- **THEN** the sketch definition receives a durable `horizontal` constraint for that line entity
- **AND** the authoring flow does not request a numeric value before commit

#### Scenario: User constrains a line vertical
- **WHEN** the user activates the Vertical constraint tool and selects an editable local line segment
- **THEN** the sketch definition receives a durable `vertical` constraint for that line entity
- **AND** the authoring flow does not request a numeric value before commit

#### Scenario: Horizontal and vertical constraints remain distinct from directional dimensions
- **WHEN** the user uses the Horizontal or Vertical constraint tool on a supported line
- **THEN** the editor authors a geometric constraint rather than a horizontal or vertical distance dimension
- **AND** the durable sketch definition does not append a dimension record for that action
