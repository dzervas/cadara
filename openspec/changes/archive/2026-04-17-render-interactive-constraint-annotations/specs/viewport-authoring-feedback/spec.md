## ADDED Requirements

### Requirement: Viewport SHALL render and hit-test committed constraint glyphs
The viewport SHALL render committed sketch constraint and dimension glyphs from annotation descriptors and expose hit targets that resolve to durable annotation references.

#### Scenario: Annotation glyph is picked
- **WHEN** the user clicks inside a committed annotation glyph hit target
- **THEN** the viewport resolves the durable constraint or dimension reference for editor selection

#### Scenario: Annotation glyph is hovered
- **WHEN** the pointer hovers a committed annotation glyph
- **THEN** the viewport exposes hover feedback for the annotation and affected sketch geometry
