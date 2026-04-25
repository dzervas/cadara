# sketch-constraint-authoring Specification

## Purpose
TBD - created by archiving change wire-sketch-constraint-frontend. Update Purpose after archive.
## Requirements
### Requirement: Sketch constraints SHALL be exposed as first-class sketch authoring tools
The system SHALL expose supported sketch constraint and dimension operations through the sketch-mode tool system using stable tool identities, toolbar metadata, and activation behavior defined outside presentational UI components.

#### Scenario: Toolbar shows supported constraint operations
- **WHEN** the user enters sketch mode
- **THEN** the toolbar exposes the supported sketch constraint and dimension operations needed by the current authoring surface, including grouped variants where multiple operations share one tool family

#### Scenario: User activates a constraint operation
- **WHEN** the user activates a sketch constraint tool from the toolbar, dropdown, or search surface
- **THEN** the workbench activates the matching constraint-authoring workflow through the shared tool action flow and sketch runtime rather than through tool-specific React branches

### Requirement: Constraint authoring SHALL guide target selection with staged cursor and preview behavior
The system SHALL represent active constraint authoring as an ordered target-selection workflow with operation-specific cursor guidance and transient viewport previews before any durable commit occurs.

#### Scenario: Constraint operation waits for required selections
- **WHEN** a geometric constraint such as coincident, parallel, or equal-length becomes active
- **THEN** the editor runtime guides the user through the required point/entity selections and updates the active cursor/prompt state for the current selection step

#### Scenario: Pointer hovers or partial selections exist
- **WHEN** the active constraint operation has a hover candidate or a partial set of selected targets
- **THEN** the viewport shows a transient preview of the pending constraint annotation or relationship without storing it yet in the durable sketch document

### Requirement: Constraint authoring SHALL support floating authored-value entry when required
The system SHALL support a generic floating input surface for constraint or dimension operations that require an authored value such as length, distance, angle, or radius.

#### Scenario: Dimensional constraint needs a numeric value
- **WHEN** the user finishes selecting the required targets for a dimensional constraint
- **THEN** the editor runtime opens a floating value-entry prompt bound to the active operation and does not commit the durable mutation until the value is accepted

#### Scenario: Value entry is cancelled
- **WHEN** the user cancels the floating value-entry prompt for a pending constraint operation
- **THEN** the pending preview and authored-value draft are discarded without appending a durable constraint or dimension record

### Requirement: Constraint target selection SHALL work while a constraint tool is active
The system SHALL allow active sketch constraint tools to collect valid sketch point, entity, and annotation targets from viewport selections during their target-collection phase.

#### Scenario: Hovered constraint target is selected
- **WHEN** a constraint tool shows a valid hover candidate and the user clicks that candidate
- **THEN** the active constraint authoring state records the clicked target as the next selected constraint target

#### Scenario: Invalid target click is ignored with existing feedback
- **WHEN** a constraint tool is active and the user clicks a target rejected by that tool's selection rules
- **THEN** the authoring state does not record the target and the editor preserves or reports the existing selection rejection feedback

### Requirement: Committed constraints SHALL remain durable sketch document records
The system SHALL store each committed sketch constraint or dimension as durable authored sketch data keyed by stable constraint or dimension identifiers rather than as viewport-only presentation state.

#### Scenario: Constraint operation is committed
- **WHEN** a valid sketch constraint or dimension operation is accepted
- **THEN** the frontend routes a durable sketch mutation through the modeling boundary and the authoritative sketch document records the committed constraint or dimension with its stable ID and authored inputs

#### Scenario: Document is reloaded or rebuilt
- **WHEN** the sketch document is restored, replayed, or re-solved
- **THEN** committed constraints and dimensions remain present because they are owned by the durable sketch document rather than the transient viewport session

### Requirement: Committed constraints SHALL be rendered and selectable in the viewport
The system SHALL render committed sketch constraints and dimensions as viewport annotations derived from durable sketch records and solved geometry, and those annotations SHALL participate in editor selection and deletion flows.

#### Scenario: Sketch contains committed constraints
- **WHEN** the viewport renders a solved sketch that has committed constraint or dimension records
- **THEN** it shows the corresponding annotation glyphs, labels, or markers using descriptors keyed to the durable authored IDs

#### Scenario: User hovers a committed annotation
- **WHEN** the user hovers a committed constraint or dimension annotation glyph
- **THEN** the editor highlights the affected sketch geometry without selecting that geometry

#### Scenario: User selects a committed annotation
- **WHEN** the user clicks a committed constraint or dimension annotation glyph
- **THEN** the editor selects the annotation target and highlights the affected sketch geometry

#### Scenario: User selects and deletes a committed annotation
- **WHEN** the user selects a committed constraint or dimension annotation in the viewport and invokes delete
- **THEN** the editor resolves that selection back to the durable authored ID and removes it through the documented sketch/modeling mutation flow

### Requirement: Constraint authoring SHALL preserve frontend, modeling, and solver separation
The system SHALL keep target picking, cursor state, preview rendering, and floating input in the frontend editor layer; durable sketch mutations in the modeling boundary; and authoritative constraint solving in the sketch solver boundary.

#### Scenario: Frontend stages a new constraint
- **WHEN** the user is still selecting targets or entering a value for a constraint operation
- **THEN** that transient authoring state remains frontend-owned and does not require solver implementation code inside React components

#### Scenario: Committed constraint needs solve feedback
- **WHEN** a committed constraint changes the sketch solve result
- **THEN** the resulting solved geometry and constraint status are produced through the solver boundary rather than inferred by the viewport renderer itself

### Requirement: Constraint authoring SHALL preview the pending geometric reference
The system SHALL show transient viewport preview geometry for active dimensional and angular constraint operations before committing durable constraint records.

#### Scenario: Dimension preview is active
- **WHEN** the user has selected enough targets to preview a dimensional constraint
- **THEN** the viewport shows a thin transient dimension reference that indicates what geometry the dimension will constrain

#### Scenario: Angle preview is active
- **WHEN** the user has selected enough line or point references to preview an angle constraint
- **THEN** the viewport shows a transient arc between the affected references

### Requirement: Dimensional constraints SHALL disambiguate reference direction from pointer position
The system SHALL allow dimensional constraint authoring to choose among available reference directions, such as diagonal, horizontal, and vertical distance, based on pointer position near the implied dimension reference.

#### Scenario: Point-to-point dimension changes reference mode
- **WHEN** a dimension between two points could represent diagonal, horizontal, or vertical distance
- **THEN** moving the pointer near each implied reference line updates the preview to the corresponding dimension reference before commit

### Requirement: Constraint value entry SHALL appear near the active preview
The system SHALL render value-entry input for dimensional or angular constraints near the active mouse position or preview reference in the viewport.

#### Scenario: Dimension value is requested
- **WHEN** a dimensional constraint has selected its required targets and needs an authored value
- **THEN** the numeric input appears near the active preview reference rather than in a detached feature-editor-style panel

### Requirement: Constraint authoring SHALL collect projected reference targets
The system SHALL allow explicit constraint tools to collect projected reference geometry targets when the active operation supports the projected geometry kind.

#### Scenario: Constraint tool accepts projected line
- **WHEN** a line relationship constraint tool is active and the user selects projected line geometry
- **THEN** the constraint authoring state records the projected line as a valid target for that operation

#### Scenario: Constraint tool rejects unsupported projected geometry
- **WHEN** the active constraint operation does not support the hovered projected geometry kind
- **THEN** the editor rejects the target using the existing selection feedback path
- **AND** no durable constraint is committed

### Requirement: Constraint authoring SHALL include automatic snap-derived constraints
The system SHALL allow sketch tools to author constraints derived from accepted snap intent in addition to constraints created through explicit constraint tools.

#### Scenario: Horizontal snap is accepted while drawing a line
- **WHEN** a line drawing operation is accepted with active horizontal snap intent
- **THEN** the committed sketch contribution includes a horizontal constraint for the new line

#### Scenario: Snap intent is cancelled
- **WHEN** the user cancels a drawing operation with active snap intent
- **THEN** no inferred constraint is appended to the durable sketch definition

### Requirement: Geometry deletion SHALL remove dependent sketch constraints and dimensions
The system SHALL remove committed sketch constraints and dimensions that reference sketch geometry deleted from an active sketch session.

#### Scenario: Deleting an entity removes constraints that reference it
- **WHEN** the user deletes a selected sketch entity that is referenced by one or more committed constraints or dimensions
- **THEN** the deleted entity is removed from the active sketch definition
- **AND** every committed constraint or dimension that references the deleted entity is removed from the active sketch definition
- **AND** committed constraints and dimensions that do not reference the deleted entity remain present

#### Scenario: Deleting a point removes constraints that reference it
- **WHEN** the user deletes a selected sketch point that is referenced by one or more committed constraints or dimensions
- **THEN** the deleted point is removed from the active sketch definition
- **AND** every committed constraint or dimension that references the deleted point is removed from the active sketch definition
- **AND** committed constraints and dimensions that do not reference the deleted point remain present

#### Scenario: Dependency cleanup leaves no dangling sketch references
- **WHEN** selected sketch geometry is deleted from an active sketch
- **THEN** the resulting authored sketch definition contains no committed constraint or dimension record that references the deleted local point or entity IDs

### Requirement: Dimension authoring SHALL support diameter dimensions for circles and arcs
The system SHALL allow the active sketch Dimension tool to create a driving diameter dimension from one selected local circle or arc entity.

#### Scenario: User dimensions a circle diameter
- **WHEN** the user activates Dimension and selects a local sketch circle
- **THEN** the authoring flow previews a diameter dimension for that circle
- **AND** accepting the authored value commits a durable diameter dimension that references the selected circle entity

#### Scenario: User dimensions an arc diameter
- **WHEN** the user activates Dimension and selects a local sketch arc
- **THEN** the authoring flow previews a diameter dimension for the arc's solved radius
- **AND** accepting the authored value commits a durable diameter dimension that references the selected arc entity

### Requirement: Dimension authoring SHALL support line and vertex distance dimensions
The system SHALL allow the active sketch Dimension tool to create driving distance dimensions between supported sketch-space line and point references.

#### Scenario: User dimensions between parallel sketch lines
- **WHEN** the user activates Dimension and selects two local sketch line segments that are parallel within tolerance
- **THEN** the authoring flow previews the perpendicular distance between the selected line references
- **AND** accepting the authored value commits a durable line-to-line distance dimension that references both selected line entities

#### Scenario: User dimensions between a sketch line and vertex
- **WHEN** the user activates Dimension and selects one local sketch line segment and one local sketch point in either order
- **THEN** the authoring flow previews the perpendicular distance from the point to the line reference
- **AND** accepting the authored value commits a durable line-to-point distance dimension that references the selected line entity and point

#### Scenario: User selects unsupported distance targets
- **WHEN** the Dimension tool receives targets that do not form a supported distance dimension
- **THEN** the sketch definition remains unchanged
- **AND** the authoring flow reports target validation feedback without committing a partial dimension

### Requirement: Dimension authoring SHALL support line length dimensions from a single edge
The system SHALL allow the active sketch Dimension tool to create a driving line-length dimension from one selected local sketch line segment.

#### Scenario: User dimensions a line segment length
- **WHEN** the user activates Dimension and selects one local sketch line segment
- **THEN** the authoring flow previews a line-length dimension for that edge
- **AND** a primary viewport click away from selecting a second dimension target opens the floating value-entry prompt
- **AND** accepting the authored value commits a durable line-length dimension that references the selected line entity

#### Scenario: User continues from one line to a two-target dimension
- **WHEN** the user activates Dimension and selects one local sketch line segment
- **AND** the user next selects another supported dimension target before pinning value placement
- **THEN** the authoring flow uses the two selected targets for the supported line distance, line-point distance, or line angle workflow

### Requirement: Dimension authoring SHALL support angle dimensions between non-parallel lines
The system SHALL treat two non-parallel line targets selected with the Dimension tool as an angular dimension workflow from preview through durable commit.

#### Scenario: User places an angle dimension from non-parallel lines
- **WHEN** the user activates Dimension and selects two non-parallel local sketch line segments
- **THEN** the authoring flow previews an angle arc between the selected line references
- **AND** the next primary viewport click pins the angle annotation placement and opens the floating value-entry prompt
- **AND** the prompt is labeled as an angle value rather than a distance value

#### Scenario: User commits an angle dimension value
- **WHEN** an angle dimension value-entry prompt is open after two non-parallel line targets are selected
- **AND** the user enters a value in degrees and accepts it
- **THEN** the durable sketch definition stores a `lineAngle` dimension for the selected lines
- **AND** the stored `valueRadians` matches the entered degree value converted to radians

#### Scenario: User edits a committed angle dimension annotation
- **WHEN** the user reopens a committed line angle dimension annotation
- **THEN** the floating value-entry prompt is seeded with the current angle in degrees
- **AND** accepting the edit updates the durable `valueRadians` field after converting the entered degrees to radians

#### Scenario: Parallel lines are not angle targets
- **WHEN** the user activates Dimension and selects two local sketch line segments that are parallel within tolerance
- **THEN** the authoring flow does not commit an angle dimension for those targets
- **AND** the targets remain available for the supported line-to-line distance workflow

### Requirement: Dimension authoring SHALL persist annotation placement with durable dimensions
The system SHALL store the user-selected annotation placement for committed dimensions as sketch-plane dimension metadata rather than viewport-only state.

#### Scenario: Linear dimension placement is accepted
- **WHEN** the user drags the pending dimension line for a distance or diameter dimension and accepts the authored value
- **THEN** the committed dimension stores placement metadata sufficient to reproduce the chosen dimension line offset from solved sketch geometry

#### Scenario: Angle dimension placement is accepted
- **WHEN** the user drags the pending angle arc and accepts the authored value
- **THEN** the committed angle dimension stores placement metadata sufficient to reproduce the chosen arc radius and side from solved sketch geometry

#### Scenario: Dimension authoring is cancelled
- **WHEN** the user cancels a pending dimension after changing its annotation placement
- **THEN** the pending value and pending annotation placement are discarded
- **AND** no durable dimension record is appended to the sketch definition

### Requirement: Committed dimensions SHALL present compact dimension annotations
The system SHALL render committed dimensions as dimension-specific annotations whose visible chip content is a compact dimension glyph plus the authored measurement value rather than a verbose constraint-style badge label.

#### Scenario: Committed rectangle dimension is shown in the viewport
- **WHEN** the active sketch contains a committed width, height, radius, diameter, distance, or angle dimension
- **THEN** the viewport shows that committed dimension as a compact dimension annotation chip
- **AND** the chip's visible text is the measurement value for that dimension
- **AND** the chip does not render verbose text such as the sketch entity label or dimensional role as part of the visible annotation content

#### Scenario: Compact dimension annotation preserves accessible detail
- **WHEN** the viewport renders a committed compact dimension annotation
- **THEN** the annotation still preserves descriptive label/detail text for accessibility, diagnostics, and tooltip metadata
- **AND** reducing the visible text to a compact value does not remove the durable annotation's editability or identity

### Requirement: Dimension annotations SHALL avoid deprecated directional labels
The system SHALL keep committed dimension visible text compact and SHALL avoid exposing deprecated internal directional labels as user-facing annotation detail.

#### Scenario: Committed distance dimension metadata is displayed
- **WHEN** the viewport renders a committed distance, horizontal distance, vertical distance, line distance, or point-line distance dimension
- **THEN** the visible annotation chip shows only the compact numeric value
- **AND** accessible detail text uses current measurement wording such as distance and units
- **AND** accessible detail text does not expose internal role labels such as aligned, horizontal, or vertical as the measurement type

#### Scenario: Committed angle dimension metadata is displayed
- **WHEN** the viewport renders a committed line angle dimension
- **THEN** the visible annotation chip shows the angle value in degrees
- **AND** the annotation glyph and accessible detail identify the annotation as an angle dimension

### Requirement: Committed dimension annotations SHALL support direct editing from the annotation chip
The system SHALL treat the committed dimension annotation chip itself as the durable edit affordance for that dimension.

#### Scenario: User double-clicks a committed dimension annotation
- **WHEN** the user double-clicks a committed dimension annotation chip
- **THEN** the editor reopens the floating numeric input for that durable dimension
- **AND** the reopened input is seeded from the current committed dimension value

#### Scenario: User commits an edit from a reopened dimension annotation
- **WHEN** the user edits the reopened committed dimension value and accepts it
- **THEN** the durable dimension record is updated with the new value
- **AND** the committed dimension annotation continues to represent the same durable dimension target
