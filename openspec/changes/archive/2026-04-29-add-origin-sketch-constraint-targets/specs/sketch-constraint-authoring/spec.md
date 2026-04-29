## ADDED Requirements

### Requirement: Constraint authoring SHALL collect sketch datum reference targets
The system SHALL allow compatible sketch constraint tools to collect the sketch origin point and sketch-local X or Y axes as read-only reference targets without creating local proxy geometry.

#### Scenario: User constrains a local point to the sketch origin
- **WHEN** the user activates a compatible point-reference constraint tool and selects one editable local sketch point plus the sketch origin datum point
- **THEN** the authoring flow commits a durable origin-targeted constraint for that local point
- **AND** the sketch definition does not append a local helper point or construction entity for the origin

#### Scenario: User constrains local geometry against a sketch datum axis
- **WHEN** the user activates a compatible line-reference constraint tool and selects one editable local sketch line plus the sketch-local X axis or Y axis
- **THEN** the authoring flow commits a durable datum-axis-targeted constraint when that relationship is supported
- **AND** the datum axis remains read-only sketch context

#### Scenario: User selects an incompatible datum target
- **WHEN** the active constraint tool receives the sketch origin point or a sketch datum axis for a relationship that does not support that point or line reference kind
- **THEN** the editor rejects the target through the existing validation feedback path
- **AND** no partial durable constraint is committed

### Requirement: Dimension authoring SHALL accept compatible sketch datum references
The system SHALL allow the active sketch Dimension workflow to use the sketch origin point and sketch-local X or Y axes wherever the existing distance or angle workflows already support compatible point or line references.

#### Scenario: User dimensions from a local point to the sketch origin
- **WHEN** the user activates the Distance dimension workflow and selects one editable local sketch point plus the sketch origin datum point
- **THEN** the authoring flow previews the supported point-reference dimension
- **AND** accepting the authored value commits a durable dimension that references the local point and the origin datum point

#### Scenario: User dimensions a local line against a sketch datum axis
- **WHEN** the user activates the Distance dimension workflow and selects one editable local sketch line plus the sketch-local X axis or Y axis
- **THEN** the authoring flow previews the supported line-to-axis distance or angle relationship using the selected datum axis
- **AND** accepting the authored value commits a durable dimension that references the local line and the datum axis

#### Scenario: User selects incompatible datum pairs for a dimension
- **WHEN** the active dimension workflow receives datum-reference targets that do not match an existing supported point or line dimension relationship
- **THEN** the authoring flow preserves the current sketch definition unchanged
- **AND** it reports target validation feedback without committing a partial dimension
