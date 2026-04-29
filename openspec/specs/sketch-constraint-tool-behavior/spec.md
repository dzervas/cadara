# sketch-constraint-tool-behavior Specification

## Purpose
Defines sketch constraint tool availability, target selection, solver behavior, and annotation feedback for sketch-mode constraint commands.
## Requirements
### Requirement: Sketch constraint toolbar SHALL expose the added constraint tools
The system SHALL expose Horizontal, Vertical, Concentric, Midpoint, Normal, Pierce, Symmetric, and Fix Geometry as sketch-mode constraint tools with stable tool IDs, tooltips, toolbar grouping, and dedicated SVG icons.

#### Scenario: User enters sketch mode
- **WHEN** the sketch toolbar is built for an active sketch session
- **THEN** it includes `constraintHorizontal`, `constraintVertical`, `constraintConcentric`, `constraintMidpoint`, `constraintNormal`, `constraintPierce`, `constraintSymmetric`, and `constraintFix` in the constraint tool group
- **AND** each tool uses the corresponding existing SVG icon asset

#### Scenario: User is in part mode
- **WHEN** the toolbar is built outside an active sketch session
- **THEN** the added constraint tools are not available as part-mode commands

### Requirement: Concentric SHALL constrain circle and arc centers
The system SHALL allow users to constrain local circle or arc centers to remain coincident with another local or projected circle or arc center.

#### Scenario: User constrains two local circles concentric
- **WHEN** the user activates Concentric and selects two local circle or arc entities
- **THEN** the sketch draft receives a durable concentric constraint for the selected entities
- **AND** solving the draft keeps the selected curve centers coincident
- **AND** the committed annotation uses the concentric glyph

#### Scenario: User constrains a local circle to a projected circle
- **WHEN** the user activates Concentric and selects one editable local circle or arc and one projected circle or arc
- **THEN** the sketch draft receives a durable projected-concentric constraint that stores the projected geometry operand
- **AND** solving the draft keeps the local curve center coincident with the projected curve center

### Requirement: Midpoint SHALL constrain points to line midpoints
The system SHALL allow users to constrain an editable point to the midpoint of a local or projected line.

#### Scenario: User constrains a point to a local line midpoint
- **WHEN** the user activates Midpoint and selects an editable point plus a local line segment
- **THEN** the sketch draft receives a durable midpoint constraint for the point and line
- **AND** solving the draft places the point at the solved midpoint of the line
- **AND** the committed annotation uses the midpoint glyph

#### Scenario: User constrains a point to a projected line midpoint
- **WHEN** the user activates Midpoint and selects an editable point plus a projected line segment
- **THEN** the sketch draft receives a durable projected-line midpoint constraint
- **AND** solving the draft places the point at the midpoint of the projected line segment

### Requirement: Normal SHALL constrain a line normal to a curve at a selected point
The system SHALL allow users to constrain an editable line to remain normal to a local or projected circle or arc at a selected editable contact point.

#### Scenario: User constrains a line normal to a circle
- **WHEN** the user activates Normal and selects an editable line, a circle or arc, and an editable contact point
- **THEN** the sketch draft receives solver-backed constraints that keep the contact point on the selected curve
- **AND** solving the draft keeps the line direction normal to the curve at the contact point
- **AND** the committed annotation uses the normal glyph

#### Scenario: User selects an invalid normal contact point
- **WHEN** the user activates Normal and selects targets that do not include an editable line, a circle or arc, and an editable point
- **THEN** the sketch draft remains unchanged
- **AND** the active tool reports validation feedback without committing a partial constraint

### Requirement: Pierce SHALL constrain points onto local or projected curves
The system SHALL allow users to constrain an editable point to lie on a selected local or projected curve through the Pierce tool.

#### Scenario: User pierces a local curve
- **WHEN** the user activates Pierce and selects an editable point plus a local line, circle, arc, or supported spline curve
- **THEN** the sketch draft receives a durable point-on-curve constraint
- **AND** solving the draft keeps the point on the selected local curve
- **AND** the committed annotation uses the pierce glyph

#### Scenario: User pierces projected geometry
- **WHEN** the user activates Pierce and selects an editable point plus projected line, circle, arc, or supported spline geometry
- **THEN** the sketch draft receives a durable point-on-projected-curve constraint that stores the projected geometry operand
- **AND** solving the draft keeps the point on the projected curve

### Requirement: Symmetric SHALL constrain points about an axis
The system SHALL allow users to constrain two editable points to remain mirrored about a selected local or projected line axis.

#### Scenario: User constrains two points symmetric about a local line
- **WHEN** the user activates Symmetric and selects two editable points plus a local line segment as the symmetry axis
- **THEN** the sketch draft receives a solver-backed symmetric relationship for those targets
- **AND** solving the draft keeps the two points mirrored across the selected line
- **AND** the committed annotation uses the symmetric glyph

#### Scenario: User constrains two points symmetric about a projected line
- **WHEN** the user activates Symmetric and selects two editable points plus a projected line segment as the symmetry axis
- **THEN** the sketch draft receives a solver-backed projected-axis symmetric relationship
- **AND** solving the draft keeps the two points mirrored across the projected line

### Requirement: Fix Geometry SHALL constrain selected geometry to its current authored placement
The system SHALL allow users to fix editable sketch points and supported editable sketch entities at their current authored position and size.

#### Scenario: User fixes a point
- **WHEN** the user activates Fix Geometry and selects an editable sketch point
- **THEN** the sketch draft receives a fix-point constraint at the point's current sketch-plane coordinates
- **AND** solving the draft keeps that point at the fixed coordinates
- **AND** the committed annotation uses the fixed glyph

#### Scenario: User fixes a line
- **WHEN** the user activates Fix Geometry and selects an editable line segment
- **THEN** the sketch draft receives constraints that fix both line endpoint coordinates
- **AND** solving the draft keeps the line in its current position and orientation

#### Scenario: User fixes a circle
- **WHEN** the user activates Fix Geometry and selects an editable circle
- **THEN** the sketch draft receives constraints that fix the circle center and current radius
- **AND** solving the draft keeps the circle in its current position and size

#### Scenario: User fixes unsupported geometry
- **WHEN** the user activates Fix Geometry and selects geometry that cannot be fixed by the sketch solver
- **THEN** the sketch draft remains unchanged
- **AND** the active tool reports validation feedback without committing a partial constraint

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

