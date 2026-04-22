# viewport-authoring-feedback Specification

## Purpose
TBD - created by archiving change fix-viewport-authoring-feedback. Update Purpose after archive.
## Requirements
### Requirement: Viewport renderables SHALL use role-appropriate authoring styling
The workbench viewport SHALL render authoring geometry with styling derived from renderable role so solids, sketch-owned regions, sketch edges, sketch lines, and sketch vertices read consistently during editing. Active and committed sketch-owned geometry MUST render as flat, unlit authoring graphics and MUST source its default colors from existing theme tokens.

#### Scenario: Render a solid object
- **WHEN** the viewport renders an opaque solid body or face
- **THEN** that solid renders with an opaque off-white surface treatment

#### Scenario: Render a selectable sketch-owned region
- **WHEN** the viewport renders a region owned by an active or committed sketch
- **THEN** that region renders with a deeper neutral gray fill treatment sourced from an existing dark/workbench gray theme token such as `--workbench-shell-border`
- **AND** the region fill remains visually subordinate to wire geometry
- **AND** the region does not use reflective or light-dependent material treatment

#### Scenario: Render sketch wire geometry
- **WHEN** the viewport renders sketch edges or lines for an active or committed sketch
- **THEN** those edges or lines render with flat, unlit material treatment
- **AND** their default color is resolved from the owning sketch's constraint state using existing theme tokens

#### Scenario: Render a sketch vertex marker
- **WHEN** the viewport renders a vertex marker for active or committed sketch geometry
- **THEN** the marker is smaller than the prior default marker size and uses the same constraint-state color family as rendered sketch lines or edges when it belongs to a sketch
- **AND** sketch vertex markers do not use reflective or light-dependent material treatment

### Requirement: Sketch constraint-state colors SHALL come from the theme
The workbench viewport SHALL color active and committed sketch edges, vertices, and constraint annotations by sketch constraint state using only existing theme-defined colors. Authored or selected colors SHALL remain visible except where overconstrained affected geometry requires a thin diagnostic/error overlay.

#### Scenario: Render a fully constrained sketch
- **WHEN** a sketch's solved status reports `constraintState` as `wellConstrained`
- **THEN** its default sketch edges, vertices, and constraint annotations use `--workbench-tooltip-description`

#### Scenario: Render an underconstrained sketch
- **WHEN** a sketch's solved status reports `constraintState` as `underConstrained` or `unknown`
- **THEN** its default sketch edges, vertices, and constraint annotations use `--mantine-color-blue-9`

#### Scenario: Render an overconstrained sketch
- **WHEN** a sketch's solved status reports `constraintState` as `overConstrained` or `inconsistent`
- **THEN** affected sketch edges, vertices, and constraint annotations use a thin diagnostic/error treatment colored by `--workbench-shell-danger-text`
- **AND** unaffected sketch geometry keeps its normal default, authored, or selected color

#### Scenario: Render a failed constrained solve
- **WHEN** a sketch's solved status reports a failed or partially solved state with known unsatisfied affected geometry
- **THEN** affected sketch edges, vertices, and constraint annotations use the same thin diagnostic/error treatment colored by `--workbench-shell-danger-text`
- **AND** unaffected sketch geometry keeps its normal default, authored, or selected color

#### Scenario: Preserve authored SVG style overrides
- **WHEN** SVG rendering is enabled for a sketch and a sketch edge, point, or region has supported authored style data
- **THEN** the viewport renders that authored style data according to the SVG sketch style behavior contract
- **AND** overconstrained affected edges render only a thin predefined diagnostic line in the error color instead of recoloring the full authored stroke width
- **AND** no new non-theme color is introduced for the default constraint-state palette

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

### Requirement: Active sketch editing SHALL hide snapshot renderables for the edited sketch
The viewport SHALL hide all committed document snapshot renderables (regions, edges, and points) belonging to the actively edited sketch so that only live sketch-session-derived geometry is visible during editing.

#### Scenario: Snapshot regions are hidden during editing
- **WHEN** the user is actively editing a sketch that has committed regions in the document snapshot
- **THEN** the viewport omits those committed region renderables from the document layer
- **AND** only live sketch-session-derived region geometry is displayed

#### Scenario: Snapshot edges and points are hidden during editing
- **WHEN** the user is actively editing a sketch that has committed edges and points in the document snapshot
- **THEN** the viewport omits those committed sketch entity and sketch point renderables from the document layer

#### Scenario: Non-edited sketch renderables remain visible
- **WHEN** the document snapshot contains renderables for sketches that are not actively being edited
- **THEN** those renderables remain visible in the document layer

### Requirement: Live sketch regions SHALL be re-derived during geometry editing
The viewport SHALL display sketch regions derived from the current sketch definition during active editing, including during drag operations, so that region boundaries update in real time.

#### Scenario: Region updates during drag
- **WHEN** the user drags sketch geometry and the constraint solver produces an updated solution
- **THEN** the viewport displays regions derived from the updated solved sketch geometry
- **AND** the solver result from the drag operation is reused for region derivation without re-solving

#### Scenario: Region updates after entity deletion
- **WHEN** the user deletes sketch geometry while editing
- **THEN** the viewport displays regions derived from the updated sketch definition without stale region artifacts

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
