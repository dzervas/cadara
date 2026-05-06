# sketch-collinear-constraint Specification

## Purpose
TBD - created by archiving change add-sketch-point-collinear-constraint. Update Purpose after archive.
## Requirements
### Requirement: Collinear SHALL be a first-class sketch constraint
The system SHALL expose Collinear as a dedicated sketch constraint with stable tool identity, durable constraint records, annotation identity, and validation feedback separate from Coincident.

#### Scenario: User activates Collinear
- **WHEN** the user activates `constraintCollinear` while editing a sketch
- **THEN** the sketch session remains active
- **AND** the active constraint workflow collects collinear targets through the shared constraint-authoring flow

#### Scenario: Collinear is committed
- **WHEN** the user accepts a valid Collinear target set
- **THEN** the sketch definition receives durable collinear constraint records keyed by stable constraint IDs
- **AND** committed annotations identify the relationship as Collinear rather than Coincident

### Requirement: Collinear SHALL support line-to-line alignment
The system SHALL allow an editable local sketch line to be constrained to the same infinite underlying line as another local or projected line, including lines that do not overlap and lines that do not share vertices.

#### Scenario: User constrains separated local lines
- **WHEN** the user activates Collinear and selects two non-degenerate local line segments that do not overlap or share vertices
- **THEN** the sketch draft receives a durable collinear relationship for the selected lines
- **AND** solving the draft places the driven line on the infinite underlying geometry of the reference line

#### Scenario: User constrains a local line to a projected line
- **WHEN** the user activates Collinear and selects one editable local line plus one projected line reference in either order
- **THEN** the sketch draft receives a durable projected-line collinear relationship
- **AND** solving the draft aligns the editable line with the projected line without making the projected reference editable

### Requirement: Collinear SHALL support point-to-line alignment
The system SHALL allow an editable sketch point to be constrained to the infinite underlying geometry of a local or projected line.

#### Scenario: User constrains a point to a local line
- **WHEN** the user activates Collinear and selects one editable point plus one non-degenerate local line in either order
- **THEN** the sketch draft receives a durable collinear relationship for the point and line
- **AND** solving the draft keeps the point on the infinite line defined by the selected line segment

#### Scenario: User constrains a point to a projected line
- **WHEN** the user activates Collinear and selects one editable point plus one projected line reference in either order
- **THEN** the sketch draft receives a durable projected-line collinear relationship
- **AND** solving the draft keeps the editable point on the projected line's infinite geometry

### Requirement: Collinear SHALL support multi-target line-based alignment
The system SHALL allow one Collinear operation to align multiple editable points and editable lines to a selected reference line when every selected target has line-compatible collinear semantics.

#### Scenario: User constrains multiple targets to the first line
- **WHEN** the user activates Collinear and selects a non-degenerate line followed by additional editable lines and editable points
- **THEN** the first selected line is treated as the reference line
- **AND** the sketch draft receives durable collinear relationships aligning every later editable target to that reference line

#### Scenario: User includes a projected reference line first
- **WHEN** the user activates Collinear and selects a projected line followed by editable local points or editable local lines
- **THEN** the projected line is treated as the read-only reference
- **AND** the sketch draft receives durable collinear relationships aligning every editable local target to that projected reference

### Requirement: Collinear SHALL reject unsupported or degenerate targets
The system SHALL reject target sets that cannot form a line-based collinear relationship and SHALL report validation feedback without committing partial constraints.

#### Scenario: User selects unsupported geometry
- **WHEN** the active Collinear workflow receives circles, arcs, splines, text outlines, regions, dimensions, or other non-line-compatible targets
- **THEN** the sketch definition remains unchanged
- **AND** the authoring flow reports target validation feedback

#### Scenario: User selects only read-only targets
- **WHEN** the active Collinear workflow receives only projected or datum targets and no editable local point or line
- **THEN** the sketch definition remains unchanged
- **AND** the authoring flow reports that at least one editable local target is required

#### Scenario: Reference line is degenerate
- **WHEN** the active Collinear workflow receives a line target whose endpoints are coincident within tolerance
- **THEN** the sketch definition remains unchanged
- **AND** the authoring flow reports an invalid collinear reference

### Requirement: Collinear SHALL solve against infinite line geometry
The sketch solver SHALL evaluate durable collinear constraints against the infinite line defined by each line operand rather than against the finite segment interval.

#### Scenario: Non-overlapping lines solve collinear
- **WHEN** the solver receives a durable collinear relationship between two non-overlapping line segments
- **THEN** the solved line endpoints satisfy the reference line equation within tolerance
- **AND** the result does not require endpoint coincidence or segment overlap

#### Scenario: Point beyond segment bounds solves collinear
- **WHEN** the solver receives a durable collinear relationship between a point and a finite line segment
- **THEN** the solved point may lie beyond the segment endpoints
- **AND** the result is valid when the point lies on the segment's infinite underlying line

