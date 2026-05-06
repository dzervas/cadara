# sketch-tool-editor-schema Specification

## Purpose
TBD - created by archiving change sketch-tool-authoring-spec. Update Purpose after archive.
## Requirements
### Requirement: Sketch tool presentation SHALL be driven by a declarative schema
The system SHALL define a declarative sketch tool editor schema that generic sketch UI surfaces use to render active-tool prompts, controls, measurements, and transient guidance instead of branching on tool kind.

#### Scenario: Rendering active tool guidance
- **WHEN** a sketch tool becomes active
- **THEN** the sketch UI renders the prompts and controls defined by that tool's declarative schema

#### Scenario: Removing tool-specific prompt branching
- **WHEN** the sketch UI supports the current drawing tools
- **THEN** it does not require a hardcoded branch per sketch tool to render the standard prompt and control flow

### Requirement: The schema SHALL expose the control vocabulary needed by current sketch tools
The schema SHALL include built-in elements for tool prompts, step/status labels, lightweight numeric inputs, option choices, live measurements, completion hints, transient overlay annotations, cursor hints, and floating value-entry prompts needed by current and near-term sketch tools, including constraint authoring flows.

#### Scenario: Constraint tool requests target-picking guidance
- **WHEN** an active constraint operation is waiting for a point, line, arc, or circle selection
- **THEN** the schema can express the current selection step, cursor guidance, and any pending target feedback without requiring custom constraint UI branches

#### Scenario: Constraint tool requires a floating numeric input
- **WHEN** an active dimensional constraint needs an authored value after the required selections are complete
- **THEN** the schema can express the floating value-entry prompt and its bound action contract without requiring bespoke React state outside the sketch runtime

### Requirement: Schema interactions SHALL map cleanly to tool actions
Every interactive element in the sketch tool schema SHALL resolve to a well-defined tool action or draft patch so the generic sketch UI can update the active tool without knowledge of tool-specific geometry rules.

#### Scenario: Numeric override changes
- **WHEN** the user edits a numeric control declared by the sketch tool schema
- **THEN** the sketch UI emits the field's declared tool action or patch to the active sketch tool workflow

#### Scenario: Option selection changes
- **WHEN** the user changes an option or mode declared by the sketch tool schema
- **THEN** the sketch UI emits the declared action without interpreting tool-specific construction logic itself

### Requirement: Overlay-oriented elements SHALL be declared explicitly
The sketch tool schema SHALL declare the transient overlays and annotations required by a tool, including staged geometry labels, live dimensions, anchor markers, completion cues, and preview constraint annotations, so the rendering layer can remain generic.

#### Scenario: Displaying preview constraint annotations
- **WHEN** an active constraint operation provides a preview glyph, relationship marker, or dimensional label through the schema
- **THEN** the generic sketch overlay or viewport renderer displays that preview without knowing the operation-specific authoring algorithm

#### Scenario: Displaying anchored selection affordances
- **WHEN** an active constraint operation provides hover or partial-selection markers through the schema
- **THEN** the generic rendering layer displays those markers according to the declared descriptor payload rather than inferring behavior from tool-specific code

### Requirement: The schema SHALL support dynamic state-driven presentation without moving business logic into the UI
The sketch tool schema SHALL support dynamic prompts, disabled states, validation messages, and conditional controls derived from the active tool state while keeping the generic sketch UI limited to rendering and action dispatch.

#### Scenario: Tool prompt changes by interaction step
- **WHEN** the active tool transitions from one interaction step to another
- **THEN** the schema can change the visible prompt and controls to match the current step

#### Scenario: Tool reports validation feedback
- **WHEN** the active tool detects invalid staged geometry or incomplete input
- **THEN** the schema exposes that feedback for generic presentation without requiring the UI to infer the tool's geometric rules

### Requirement: The sketch tool schema SHALL preserve UI and solver/kernel separation
The declarative sketch tool schema MUST remain independent of solver or kernel implementation details and MUST NOT require UI code to import solver or kernel modules to render sketch tool state.

#### Scenario: Rendering with the same solver boundary
- **WHEN** the solver implementation behind the shared sketch contract changes
- **THEN** the generic sketch UI and declarative schema continue to function without solver-specific UI changes

#### Scenario: Implementing or replacing a kernel adapter
- **WHEN** a kernel adapter is added or replaced behind the modeling boundary
- **THEN** it does not need to implement or import sketch UI components to satisfy the sketch-tool presentation contract

### Requirement: Sketch tool schema SHALL support geometry-anchored drawing feedback
The sketch tool presentation schema SHALL express live drawing measurements and inputs with anchors tied to sketch geometry, cursor position, or derived measurement references.

#### Scenario: Circle creation reports diameter at the circle edge
- **WHEN** a circle drawing tool is active and has a center and live radius
- **THEN** the schema exposes a diameter or radius label anchored near the active circle edge

#### Scenario: Rectangle creation reports width and height at their edges
- **WHEN** a rectangle drawing tool is active and has opposite corners
- **THEN** the schema exposes width and height labels anchored near the corresponding rectangle edges

#### Scenario: Floating input follows active sketch context
- **WHEN** a drawing tool requests numeric value entry
- **THEN** the schema provides an anchor that allows the input to render near the active geometry or cursor instead of in a fixed feature-panel position

### Requirement: Sketch tool schema SHALL describe transient constraint preview geometry
The sketch tool presentation schema SHALL support descriptors for transient constraint preview geometry including dimension lines, extension lines, angle arcs, and preview labels.

#### Scenario: Constraint tool emits a dimension preview
- **WHEN** an active constraint tool has enough target information to preview a dimension
- **THEN** the schema can describe the dimension line, label anchor, and related extension geometry without requiring constraint-specific React branches

#### Scenario: Constraint tool emits an angle preview
- **WHEN** an active constraint tool has enough target information to preview an angle
- **THEN** the schema can describe the angle arc and label anchor without requiring viewport code to infer the constraint type

### Requirement: Sketch tool previews SHALL consume snap-adjusted pointer input
The sketch tool editor schema SHALL allow active tool previews to receive snap-adjusted pointer coordinates and snap metadata from the editor layer.

#### Scenario: Drawing preview uses snapped point
- **WHEN** an active sketch drawing tool receives a snapped pointer coordinate
- **THEN** the preview geometry is rendered from the snapped coordinate
- **AND** the tool can still access raw pointer metadata for labels or disambiguation

### Requirement: Sketch tool schema SHALL support focused style control groups
The sketch tool presentation schema SHALL describe focused style control groups for the two toolbar-visible SVG style tools, Fill and Stroke, so generic sketch UI surfaces can render style controls without SVG-tool-specific React branches. Fill type controls SHALL be part of the Fill form, and stroke enablement, width, cap, join, miter, and dash controls SHALL be part of the Stroke form.

#### Scenario: Fill controls are focused
- **WHEN** the active sketch style command is fill-focused
- **THEN** the schema exposes the fill mode, fill color, and gradient controls relevant to that command
- **AND** the schema describes enclosed region target guidance for Fill

#### Scenario: Stroke controls are focused
- **WHEN** the active sketch style command is stroke-focused
- **THEN** the schema exposes stroke enablement, color, width, cap, join, miter, dash, and gap controls supported by the sketch style contract
- **AND** the schema describes sketch edge target guidance for Stroke

#### Scenario: Style variants are integrated into focused forms
- **WHEN** the generic sketch UI renders SVG style controls
- **THEN** fill type and stroke option controls are rendered inside the Fill and Stroke forms
- **AND** the schema does not require separate fill-type or stroke-options style commands to expose those controls

### Requirement: Sketch tool schema SHALL support multi-point curve workflows
The sketch tool presentation schema SHALL describe multi-point curve placement, including current point count, completion readiness, preview geometry, and cancellation/acceptance guidance.

#### Scenario: Spline prompt updates after each point
- **WHEN** a user places spline points during an active spline operation
- **THEN** the schema exposes updated prompts, point count, preview geometry, and completion hints without requiring spline-specific React branches

### Requirement: Sketch tool schema SHALL support sketch edit previews
The sketch tool presentation schema SHALL describe edit-tool selection guidance, hover feedback, numeric controls, validation, and transient preview geometry for tools that mutate existing sketch entities.

#### Scenario: Offset exposes distance control
- **WHEN** the Offset tool has a selected entity
- **THEN** the schema exposes the offset distance control and preview geometry needed by generic sketch UI surfaces

#### Scenario: Trim exposes target feedback
- **WHEN** the Trim tool hovers or selects a candidate segment
- **THEN** the schema exposes target feedback and validation messages without requiring viewport code to implement trim rules

### Requirement: Schema SHALL express Point placement guidance
The sketch tool editor schema SHALL express Point placement prompts, cursor guidance, completion hints, validation, and transient point preview without a Point-specific UI component branch.

#### Scenario: Point waits for placement
- **WHEN** the Point tool is active before a point location is accepted
- **THEN** the generic sketch tool presentation can render its prompt and cursor guidance from the schema

#### Scenario: Point previews placement
- **WHEN** the Point tool has a hovered or pending sketch-plane location
- **THEN** the schema can describe a transient point marker anchored at that location

### Requirement: Schema SHALL express Collinear target feedback
The sketch tool editor schema SHALL express Collinear selection steps, reference-target state, hover feedback, invalid-target messages, and preview annotation descriptors through generic constraint presentation.

#### Scenario: Collinear waits for a reference
- **WHEN** Collinear is active with no valid reference target selected
- **THEN** the generic sketch tool presentation can render guidance for selecting a line reference or point/line target

#### Scenario: Collinear has partial targets
- **WHEN** Collinear has a selected reference line and is waiting for editable targets
- **THEN** the schema can describe the partial target state and preview relationship without requiring a Collinear-specific React branch

#### Scenario: Collinear rejects a target
- **WHEN** Collinear receives an unsupported target
- **THEN** the schema exposes validation feedback that the generic presentation surface can render

