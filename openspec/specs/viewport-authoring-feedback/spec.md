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

### Requirement: Viewport SHALL pin pending dimension placement before value entry
The viewport SHALL treat normal primary clicks during a pending dimension placement phase as placement confirmation for the floating value-entry prompt.

#### Scenario: User clicks empty viewport while a dimension waits for placement
- **WHEN** the Dimension tool has selected enough targets for a value-backed dimension
- **AND** the pending preview is waiting for annotation placement
- **AND** the user primary-clicks empty viewport space outside a preview drag handle
- **THEN** the viewport pins the pending annotation placement at the clicked sketch-plane point
- **AND** the floating value-entry prompt opens without clearing the selected dimension targets

#### Scenario: User clicks existing sketch geometry while a dimension waits for placement
- **WHEN** the Dimension tool has selected enough targets for a value-backed dimension
- **AND** the pending preview is waiting for annotation placement
- **AND** the user primary-clicks existing selectable sketch geometry outside a preview drag handle
- **THEN** the viewport pins the pending annotation placement at the clicked sketch-plane point
- **AND** the click does not replace the selected dimension targets

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

### Requirement: Viewport SHALL expose draggable dimension preview geometry
The viewport SHALL render pending dimension preview geometry as draggable authoring controls when the active sketch tool declares a draggable dimension line or angle arc.

#### Scenario: User drags a pending dimension line
- **WHEN** a pending linear or diameter dimension preview declares a draggable dimension line and the user drags that line
- **THEN** the viewport routes the drag update to the active sketch authoring state
- **AND** the preview line, extension lines, label anchor, and floating value input update to the new sketch-plane placement without committing a durable dimension

#### Scenario: User drags a pending angle arc
- **WHEN** a pending angle dimension preview declares a draggable angle arc and the user drags that arc
- **THEN** the viewport routes the drag update to the active sketch authoring state
- **AND** the preview arc, label anchor, and floating value input update to the new sketch-plane arc placement without committing a durable dimension

#### Scenario: Drag is cancelled
- **WHEN** the user cancels an active dimension placement drag before accepting the dimension
- **THEN** the viewport stops the drag interaction
- **AND** the durable sketch definition remains unchanged

### Requirement: Viewport SHALL render committed dimensions from stored annotation placement
The viewport SHALL derive committed distance, diameter, and angle annotation graphics from solved sketch geometry plus the dimension's stored annotation placement metadata.

#### Scenario: Committed linear dimension has placement metadata
- **WHEN** the viewport renders a committed distance or diameter dimension with stored dimension-line placement metadata
- **THEN** it displays the dimension annotation using that stored placement relative to the solved target geometry

#### Scenario: Committed angle dimension has placement metadata
- **WHEN** the viewport renders a committed angle dimension with stored arc placement metadata
- **THEN** it displays the angle annotation using that stored arc placement relative to the solved line references

#### Scenario: Committed dimension has no placement metadata
- **WHEN** the viewport renders an existing committed dimension that lacks stored annotation placement metadata
- **THEN** it displays the dimension using a deterministic default placement derived from solved geometry
- **AND** it does not mutate the sketch definition merely to render the fallback annotation

### Requirement: Viewport dimension placement SHALL preserve existing viewport interactions
Dimension preview dragging SHALL use declared overlay geometry hit targets without breaking normal sketch target picking, selection, pan, rotate, or active drawing-tool behavior.

#### Scenario: Pointer starts on draggable preview geometry
- **WHEN** the pointer drag starts on a declared draggable dimension line or angle arc
- **THEN** the viewport captures that drag for dimension placement until release or cancellation

#### Scenario: Pointer starts outside draggable preview geometry
- **WHEN** the pointer interaction starts outside declared draggable dimension preview geometry
- **THEN** the viewport continues to route the interaction through the existing target picking, drawing, selection, pan, or rotate behavior

### Requirement: Viewport SHALL initiate committed dimension placement drags from the dimension annotation chip
The viewport SHALL use the visible committed dimension annotation chip as the drag handle for committed dimension placement updates.

#### Scenario: User drags a committed dimension annotation chip
- **WHEN** the user starts a drag on the visible chip for a committed distance, radius, diameter, or angle dimension annotation
- **THEN** the viewport routes the drag through the committed dimension placement update path
- **AND** the committed dimension overlay geometry updates to the dragged placement
- **AND** the durable dimension target remains selected while the drag is in progress

#### Scenario: User drags committed dimension overlay geometry without starting on the annotation chip
- **WHEN** the pointer starts on committed dimension line or angle-arc overlay geometry outside the annotation chip
- **THEN** the viewport does not treat that gesture as the committed dimension placement drag handle
- **AND** existing non-dimension viewport interactions remain available

### Requirement: Viewport SHALL render angular witness lines for off-segment intersections
The viewport SHALL render dashed witness geometry for angular dimensions when the measured angle references the infinite extension of one or both finite line segments.

#### Scenario: Angular dimension references an intersection beyond the selected line segments
- **WHEN** a committed or preview angular dimension is derived from two non-parallel lines whose true intersection lies outside one or both finite segments
- **THEN** the viewport renders dashed witness lines extending beyond the finite segments toward the measured angle arc endpoints
- **AND** the witness lines make the referenced angle legible without changing the underlying authored line geometry

#### Scenario: Angular dimension does not require off-segment witness geometry
- **WHEN** a committed or preview angular dimension's measured intersection lies on the visible finite line segments
- **THEN** the viewport renders the angular annotation without adding misleading extra extension beyond what the measured geometry requires

### Requirement: Accepted viewport selections SHALL drive history contributor highlighting
The workbench viewport SHALL update the current history-bar contributor highlight set whenever a primary click resolves to a normal durable body-topology selection.

#### Scenario: Selecting shell geometry updates contributor highlights
- **WHEN** the user primary-clicks a selectable inner shell face
- **AND** the click resolves through the normal viewport selection path
- **THEN** the workbench selection target becomes that face
- **AND** the history highlight set updates from that face's contributor ancestry

#### Scenario: Selecting preserved topology updates contributor highlights precisely
- **WHEN** the user primary-clicks a selectable preserved back face on a shelled cube
- **AND** the click resolves through the normal viewport selection path
- **THEN** the workbench selection target becomes that face
- **AND** the history highlight set excludes unrelated downstream shell contribution

#### Scenario: Empty click clears contributor highlights
- **WHEN** the user primary-clicks empty viewport space and the current selection is cleared
- **THEN** the history-bar contributor highlight set is cleared together with the selection

### Requirement: Active sketch feedback SHALL maintain screen-space legibility during zoom
The workbench viewport SHALL render active sketch editing wires and point affordances with screen-space or pixel-clamped sizing so they remain legible and reachable across normal zoom levels. The underlying sketch geometry positions MUST continue to project according to the camera zoom; only authoring stroke thickness, marker radius, and related handle affordance sizing are screen-space presentation.

#### Scenario: Active sketch wires stay legible while zooming out
- **WHEN** the user is actively editing a sketch containing line, curve, construction, reference, hover, selection, or diagnostic wire feedback
- **AND** the user zooms the viewport out far enough that world-space stroke widths would become visually tiny
- **THEN** the rendered wire stroke remains within the active-sketch pixel-size bounds for that wire role
- **AND** the wire keeps its existing constraint-state, construction, reference, hover, selection, diagnostic, or authored SVG styling

#### Scenario: Active sketch point affordances stay legible while zooming out
- **WHEN** the user is actively editing a sketch containing vertices, endpoints, datum origin markers, projected-reference points, snap handles, reference-image anchors, or active tool point handles
- **AND** the user zooms the viewport out far enough that world-space marker radii would become visually tiny
- **THEN** the rendered point affordance remains within the active-sketch pixel-size bounds for that marker role
- **AND** the marker keeps its existing constraint-state, reference, hover, selection, overlay, or authored style treatment

#### Scenario: Pick targets track screen-space marker sizing
- **WHEN** an active sketch point affordance is rendered with pixel-clamped marker sizing
- **THEN** its pick target is derived from the same screen-space sizing model as the visible marker
- **AND** the pick target remains at least as reachable as the visible marker without changing the durable selected target reference

#### Scenario: Sketch geometry still zooms normally
- **WHEN** the user zooms in or out during active sketch editing
- **THEN** sketch entity positions, curve shapes, region boundaries, and distances continue to project according to the camera and sketch plane
- **AND** only authoring stroke thickness, marker radius, and related handle affordance sizing are stabilized in screen space

#### Scenario: Inactive and non-authoring geometry keeps its existing sizing rules
- **WHEN** the viewport renders model bodies, solid topology, datum planes, sketch regions, or sketches that are not being actively edited
- **THEN** those renderables keep their existing sizing and material behavior unless another viewport contract explicitly says otherwise

