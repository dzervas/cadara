## MODIFIED Requirements

### Requirement: Sketch constraint toolbar SHALL expose the added constraint tools
The system SHALL expose Horizontal, Vertical, Concentric, Midpoint, Normal, Pierce, Symmetric, and Fix Geometry as sketch-mode constraint tools with stable tool IDs, tooltips, toolbar grouping, and dedicated SVG icons.

#### Scenario: User enters sketch mode
- **WHEN** the sketch toolbar is built for an active sketch session
- **THEN** it includes `constraintHorizontal`, `constraintVertical`, `constraintConcentric`, `constraintMidpoint`, `constraintNormal`, `constraintPierce`, `constraintSymmetric`, and `constraintFix` in the constraint tool group
- **AND** each tool uses the corresponding existing SVG icon asset

#### Scenario: User is in part mode
- **WHEN** the toolbar is built outside an active sketch session
- **THEN** the added constraint tools are not available as part-mode commands

## ADDED Requirements

### Requirement: Horizontal SHALL constrain a local line to the sketch horizontal axis
The system SHALL allow users to constrain an editable local line segment to remain parallel to the sketch plane horizontal axis through the Horizontal tool.

#### Scenario: User constrains a local line horizontal
- **WHEN** the user activates Horizontal and selects one editable local line segment
- **THEN** the sketch draft receives a durable horizontal constraint for the selected line
- **AND** solving the draft keeps that line parallel to the sketch plane horizontal axis
- **AND** the committed annotation uses the horizontal glyph

#### Scenario: User selects an unsupported Horizontal target
- **WHEN** the user activates Horizontal and selects geometry other than one editable local line segment
- **THEN** the sketch draft remains unchanged
- **AND** the active tool reports validation feedback without committing a partial constraint

### Requirement: Vertical SHALL constrain a local line to the sketch vertical axis
The system SHALL allow users to constrain an editable local line segment to remain parallel to the sketch plane vertical axis through the Vertical tool.

#### Scenario: User constrains a local line vertical
- **WHEN** the user activates Vertical and selects one editable local line segment
- **THEN** the sketch draft receives a durable vertical constraint for the selected line
- **AND** solving the draft keeps that line parallel to the sketch plane vertical axis
- **AND** the committed annotation uses the vertical glyph

#### Scenario: User selects an unsupported Vertical target
- **WHEN** the user activates Vertical and selects geometry other than one editable local line segment
- **THEN** the sketch draft remains unchanged
- **AND** the active tool reports validation feedback without committing a partial constraint
