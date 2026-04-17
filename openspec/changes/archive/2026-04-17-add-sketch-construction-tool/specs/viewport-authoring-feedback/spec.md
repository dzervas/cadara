## ADDED Requirements

### Requirement: Viewport SHALL render construction sketch geometry with edit-only dashed styling
The workbench viewport SHALL render construction-only sketch geometry with dashed wire styling while the owning sketch is actively being edited and SHALL omit that geometry when the sketch is not actively being edited.

#### Scenario: Active sketch shows construction line
- **WHEN** the viewport renders an active sketch editing session containing a construction line segment
- **THEN** the line segment is visible with dashed wire styling

#### Scenario: Active sketch shows construction curve
- **WHEN** the viewport renders an active sketch editing session containing a construction circle or arc
- **THEN** the curve is visible with dashed wire styling

#### Scenario: Inactive sketch hides construction geometry
- **WHEN** the viewport renders a document snapshot for a sketch that is not actively being edited
- **THEN** construction-only geometry from that sketch is omitted from the visible viewport renderables

### Requirement: Construction sketch geometry SHALL remain pickable while visible
The viewport SHALL expose hover and selection bindings for visible construction sketch geometry during active sketch editing.

#### Scenario: Hover visible construction edge
- **WHEN** the pointer hovers a visible construction edge in an active sketch editing session
- **THEN** the viewport resolves that edge as a hoverable sketch target and applies hover feedback

#### Scenario: Select visible construction vertex
- **WHEN** the user clicks a visible construction vertex in an active sketch editing session
- **THEN** the viewport dispatches that vertex as the selected sketch target for the active interaction context
