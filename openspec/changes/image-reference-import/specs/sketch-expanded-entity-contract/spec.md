## MODIFIED Requirements

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
