## ADDED Requirements

### Requirement: Sketch constraint toolbar SHALL expose Collinear
The system SHALL expose Collinear as a sketch-mode constraint tool with stable tool ID, tooltip, toolbar grouping, and icon behavior.

#### Scenario: User enters sketch mode
- **WHEN** the sketch toolbar is built for an active sketch session
- **THEN** it includes `constraintCollinear` in the constraint tool group
- **AND** Collinear is available through the same toolbar, dropdown, and search surfaces as other sketch constraint tools

#### Scenario: User is in part mode
- **WHEN** the toolbar is built outside an active sketch session
- **THEN** `constraintCollinear` is not available as a part-mode command

### Requirement: Collinear SHALL present constraint-specific feedback
The active Collinear tool SHALL show target guidance, preview annotations, committed annotation glyphs, and invalid-target feedback consistent with the existing sketch constraint tools.

#### Scenario: User hovers a valid Collinear target
- **WHEN** Collinear is active and the user hovers a valid point or line target
- **THEN** the viewport presents valid target feedback through the existing sketch constraint feedback path

#### Scenario: User hovers an unsupported target
- **WHEN** Collinear is active and the user hovers unsupported geometry
- **THEN** the viewport or tool prompt reports that the target cannot be used for Collinear
- **AND** no selection is recorded from that hover alone
