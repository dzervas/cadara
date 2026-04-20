# sketch-advanced-curve-text-tools Specification

## Purpose
Define sketch-mode authoring tools for advanced curve and profile-generating text entities so users can create first-class durable sketch geometry without flattening authored intent into preview samples or lower-level approximations.

## Requirements
### Requirement: Advanced curve and text tools SHALL be available in sketch mode
The system SHALL expose sketch-mode tools for ellipse, elliptical arc, conic, Bezier curve, spline control-point mode, and profile-generating text.

#### Scenario: User activates an advanced tool
- **WHEN** the user activates an advanced curve or text tool while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the tool enters its expected staged authoring workflow

### Requirement: Advanced tools SHALL commit first-class durable entities
Advanced curve and text tools SHALL commit the first-class entity kinds defined by the expanded sketch entity contract.

#### Scenario: Ellipse is committed
- **WHEN** the user completes a valid ellipse interaction
- **THEN** the sketch definition contains a durable ellipse entity with its defining references and parameters

#### Scenario: Text is committed
- **WHEN** the user completes a valid text interaction
- **THEN** the sketch definition contains a durable profile-generating text entity
- **AND** the entity remains editable as text rather than only as generated outline geometry

### Requirement: Advanced tools SHALL validate degenerate input
Advanced curve and text tools SHALL reject degenerate geometry or invalid text input without mutating the authored sketch definition.

#### Scenario: Degenerate advanced curve is rejected
- **WHEN** the user attempts to complete an advanced curve with insufficient points, duplicate defining points, zero radii, or otherwise invalid parameters
- **THEN** the editor reports validation feedback
- **AND** no partial advanced entity is committed

#### Scenario: Invalid text is rejected
- **WHEN** the user attempts to commit profile-generating text without supported text content or placement data
- **THEN** the editor reports validation feedback
- **AND** no partial text entity is committed

### Requirement: Advanced tool previews SHALL remain transient
The system SHALL use sampled or helper geometry only as transient preview state and SHALL commit the semantic advanced entity as the durable authored result.

#### Scenario: Bezier preview is shown
- **WHEN** the user is placing a Bezier curve
- **THEN** the viewport may show sampled preview geometry and control handles
- **AND** accepting the tool commits a durable Bezier entity rather than the preview samples

### Requirement: Profile-generating text SHALL expose supported downstream profiles
Profile-generating text authored by the text tool SHALL expose selectable derived profiles when the text outlines can be resolved.

#### Scenario: Text profile is available
- **WHEN** profile-generating text has supported outlines in a sketch
- **THEN** downstream feature authoring can select the resulting profile regions
