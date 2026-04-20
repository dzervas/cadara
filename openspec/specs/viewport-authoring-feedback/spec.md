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

### Requirement: Viewport feedback SHALL show active snap candidates
The viewport SHALL render transient snap indicators for the active sketch snap candidate without storing those indicators as durable sketch data.

#### Scenario: Midpoint snap is active
- **WHEN** the active snap candidate is a midpoint
- **THEN** the viewport shows a midpoint snap indicator at the snapped sketch-space point

#### Scenario: Snap candidate changes
- **WHEN** pointer movement changes the active snap candidate
- **THEN** the viewport updates the transient snap indicator and removes stale snap feedback

### Requirement: Empty viewport clicks SHALL clear selection
The workbench viewport SHALL clear the current selection when the user primary-clicks empty viewport space, regardless of the current tool state.

#### Scenario: Empty click with no active tool
- **WHEN** the user has a workbench selection and primary-clicks empty space inside the viewport with no active tool
- **THEN** the workbench clears the current selection

#### Scenario: Empty click with active tool
- **WHEN** the user has a workbench selection and primary-clicks empty space inside the viewport while a tool is active
- **THEN** the workbench clears the current selection

#### Scenario: Target click keeps selection routing
- **WHEN** the user primary-clicks a selectable target inside the viewport
- **THEN** the viewport routes the click through the existing target selection behavior instead of treating it as empty space

### Requirement: Transient sketch tool geometry SHALL stay separate from accepted sketch geometry
The viewport SHALL render transient active-tool sketch geometry from explicit staged tool state and SHALL render accepted sketch geometry from the active sketch definition.

#### Scenario: Tool preview is shown while active
- **WHEN** an active sketch tool provides transient staged geometry
- **THEN** the viewport renders that staged geometry together with accepted definition-derived sketch geometry
- **AND** the staged geometry is not written into the accepted sketch entity source of truth until accepted through the sketch tool flow

#### Scenario: Tool preview is cleared after tool exit
- **WHEN** the active sketch tool is cancelled, finished, or replaced by another tool
- **THEN** transient staged geometry from the prior tool is removed from the viewport
- **AND** accepted definition-derived geometry remains visible

#### Scenario: Accepted entity changes while preview state exists
- **WHEN** accepted sketch definition geometry changes while transient staged geometry is present
- **THEN** the viewport derives accepted renderables from the updated sketch definition
- **AND** it keeps only the current staged tool geometry as transient authoring feedback

