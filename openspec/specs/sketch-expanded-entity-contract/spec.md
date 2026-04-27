# sketch-expanded-entity-contract Specification

## Purpose
Defines durable sketch contract support for advanced authored curve and profile text entities so later tools can persist, select, render, solve, and derive profiles from semantic geometry without flattening it into legacy primitive approximations.
## Requirements
### Requirement: Advanced sketch entities SHALL be first-class durable records
The system SHALL represent ellipse, elliptical arc, conic, Bezier curve, profile-generating text, and image reference as explicit authored sketch entity kinds rather than approximating them as existing line, arc, circle, or spline records in durable sketch state.

#### Scenario: Advanced entity is persisted
- **WHEN** a sketch definition contains an ellipse, elliptical arc, conic, Bezier curve, profile-generating text, or image reference entity with valid defining data
- **THEN** runtime contract validation accepts the entity
- **AND** operation history, document persistence, and snapshot hydration preserve the original entity kind and defining references

#### Scenario: Invalid advanced entity is rejected
- **WHEN** a sketch definition contains an advanced entity with missing defining points, invalid radii, invalid weights, invalid text content, missing asset references, or otherwise invalid parameters
- **THEN** runtime contract validation reports a structured diagnostic for that entity
- **AND** the invalid entity is not silently coerced into another entity kind

### Requirement: Advanced sketch entities SHALL remain addressable in the sketch graph
The system SHALL expose stable sketch entity targets and any defining point targets needed for selection, editing, styling, constraints, and later derived-geometry relationships.

#### Scenario: Advanced entity appears in selectable sketch state
- **WHEN** an active or committed sketch contains an advanced entity
- **THEN** the workbench can resolve a stable `sketchEntity` target for that entity
- **AND** defining points that are part of the authored graph can be resolved as stable `sketchPoint` targets

### Requirement: Advanced sketch entities SHALL render from authored state
The system SHALL derive viewport renderables for advanced sketch entities from the current authored sketch definition or solved snapshot.

#### Scenario: Advanced entity is displayed
- **WHEN** a sketch containing an advanced entity is visible in the viewport
- **THEN** the viewport displays the entity using the current sketch style and construction state
- **AND** stale generated geometry from a previous edit is not displayed instead of the current entity

### Requirement: Profile-generating advanced entities SHALL participate in downstream profile extraction
The system SHALL allow supported advanced sketch entities, including profile-generating text, to participate in derived profile boundaries when their authored geometry defines a valid closed profile.

#### Scenario: Profile-generating text is consumed by a feature
- **WHEN** a sketch contains supported profile-generating text with valid outlines
- **THEN** profile extraction exposes selectable profile regions that downstream feature authoring can consume

#### Scenario: Unsupported profile conversion is encountered
- **WHEN** an advanced entity is valid but cannot yet be converted into profile boundary geometry
- **THEN** the system reports a structured unsupported-case diagnostic
- **AND** unrelated supported sketch profiles remain available

