# viewport-authoring-feedback Specification

## Purpose
TBD - created by archiving change fix-viewport-authoring-feedback. Update Purpose after archive.
## Requirements
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

### Requirement: Viewport clicks SHALL reach active sketch constraint tools
The workbench viewport SHALL dispatch valid click selections to active sketch constraint tools while preserving pointer construction behavior for active sketch drawing tools.

#### Scenario: Active constraint tool receives a picked sketch target
- **WHEN** a sketch constraint tool is active and the user clicks sketch geometry accepted by that tool
- **THEN** the viewport dispatches the selected target to the editor constraint-authoring flow

#### Scenario: Active drawing tool keeps construction behavior
- **WHEN** a sketch drawing tool is active and the user clicks in the viewport to construct geometry
- **THEN** the viewport continues to route the click through the sketch pointer construction flow instead of treating it as an ordinary selection

### Requirement: Active sketch drawing feedback SHALL render inside the viewport
The workbench viewport SHALL render active sketch drawing measurements and numeric inputs as viewport overlays near the geometry being authored.

#### Scenario: User creates a circle
- **WHEN** the user is creating a circle in sketch mode
- **THEN** the viewport shows the live diameter or radius near the outer edge of the circle being created

#### Scenario: User creates a rectangle
- **WHEN** the user is creating a rectangle in sketch mode
- **THEN** the viewport shows the live width and height near the rectangle geometry being created

#### Scenario: User creates a line
- **WHEN** the user is creating a line in sketch mode
- **THEN** the viewport shows live line measurements near the active line rather than in a detached feature-editor-style panel

### Requirement: Viewport SHALL render transient sketch constraint previews
The viewport SHALL render active sketch constraint previews as transient authoring graphics and SHALL remove those graphics when the constraint operation is cancelled, completed, or changed.

#### Scenario: Constraint preview is shown during authoring
- **WHEN** a sketch constraint operation provides preview descriptors
- **THEN** the viewport renders the corresponding thin dimension lines, angle arcs, or labels inside the viewport

#### Scenario: Constraint preview is removed after authoring
- **WHEN** the active constraint operation is completed or cancelled
- **THEN** the viewport removes the transient preview graphics unless committed annotation rendering independently displays durable annotation glyphs

### Requirement: Viewport SHALL render and hit-test committed constraint glyphs
The viewport SHALL render committed sketch constraint and dimension glyphs from annotation descriptors and expose hit targets that resolve to durable annotation references.

#### Scenario: Annotation glyph is picked
- **WHEN** the user clicks inside a committed annotation glyph hit target
- **THEN** the viewport resolves the durable constraint or dimension reference for editor selection

#### Scenario: Annotation glyph is hovered
- **WHEN** the pointer hovers a committed annotation glyph
- **THEN** the viewport exposes hover feedback for the annotation and affected sketch geometry
