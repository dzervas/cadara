## ADDED Requirements

### Requirement: Viewport SHALL render transient sketch constraint previews
The viewport SHALL render active sketch constraint previews as transient authoring graphics and SHALL remove those graphics when the constraint operation is cancelled, completed, or changed.

#### Scenario: Constraint preview is shown during authoring
- **WHEN** a sketch constraint operation provides preview descriptors
- **THEN** the viewport renders the corresponding thin dimension lines, angle arcs, or labels inside the viewport

#### Scenario: Constraint preview is removed after authoring
- **WHEN** the active constraint operation is completed or cancelled
- **THEN** the viewport removes the transient preview graphics unless committed annotation rendering independently displays durable annotation glyphs
