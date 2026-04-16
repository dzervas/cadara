## ADDED Requirements

### Requirement: Viewport renderables SHALL use role-appropriate authoring styling
The workbench viewport SHALL render authoring geometry with styling derived from renderable role so solids, regions, edges, lines, and vertices read consistently during editing.

#### Scenario: Render a solid object
- **WHEN** the viewport renders an opaque solid body or face
- **THEN** that solid renders with an opaque off-white surface treatment

#### Scenario: Render a selectable region
- **WHEN** the viewport renders a sketch or profile region
- **THEN** that region renders with a faint cyan fill treatment that remains visually subordinate to wire geometry

#### Scenario: Render a vertex marker
- **WHEN** the viewport renders a vertex marker for sketch or durable topology geometry
- **THEN** the marker is smaller than the prior default marker size and uses the same base color family as rendered lines or edges

### Requirement: Hover feedback SHALL use a mild orange accent for wire targets
The workbench viewport SHALL color hovered lines, edges, and vertices with a mild orange accent.

#### Scenario: Hover a line or edge
- **WHEN** the pointer hovers a hoverable line or edge target
- **THEN** the rendered target uses the mild orange hover color while hovered

#### Scenario: Hover a vertex
- **WHEN** the pointer hovers a hoverable vertex target
- **THEN** the rendered vertex uses the mild orange hover color while hovered

### Requirement: Edge, line, and vertex picks SHALL resolve durable interaction targets
The workbench viewport SHALL support hover and selection for edges, lines, and vertices through the same durable or editor-owned bindings used by authoring tools.

#### Scenario: Hover an edge-backed target
- **WHEN** the pointer moves over a rendered durable edge target
- **THEN** the viewport resolves that edge as a hover target instead of ignoring it

#### Scenario: Select a wire target
- **WHEN** the user clicks a rendered line, edge, or vertex that is valid for the current interaction context
- **THEN** the viewport resolves and dispatches that bound target for selection
