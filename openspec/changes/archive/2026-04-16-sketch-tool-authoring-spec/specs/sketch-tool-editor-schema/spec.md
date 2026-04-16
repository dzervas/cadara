# sketch-tool-editor-schema Specification

## ADDED Requirements

### Requirement: Sketch tool presentation SHALL be driven by a declarative schema
The system SHALL define a declarative sketch tool editor schema that generic sketch UI surfaces use to render active-tool prompts, controls, measurements, and transient guidance instead of branching on tool kind.

#### Scenario: Rendering active tool guidance
- **WHEN** a sketch tool becomes active
- **THEN** the sketch UI renders the prompts and controls defined by that tool's declarative schema

#### Scenario: Removing tool-specific prompt branching
- **WHEN** the sketch UI supports the current drawing tools
- **THEN** it does not require a hardcoded branch per sketch tool to render the standard prompt and control flow

### Requirement: The schema SHALL expose the control vocabulary needed by current sketch tools
The schema SHALL include built-in elements for tool prompts, step/status labels, lightweight numeric inputs, option choices, live measurements, completion hints, and transient overlay annotations needed by current and near-term sketch tools.

#### Scenario: Line tool expresses live length guidance
- **WHEN** a line tool describes its active interaction state
- **THEN** the schema can express its prompt, live length readout, and completion hint without requiring custom tool UI code

#### Scenario: Circle tool expresses radius guidance
- **WHEN** a circle tool describes its active interaction state
- **THEN** the schema can express its center-selection prompt, radius readout, and any standard numeric override controls without requiring custom tool UI code

### Requirement: Schema interactions SHALL map cleanly to tool actions
Every interactive element in the sketch tool schema SHALL resolve to a well-defined tool action or draft patch so the generic sketch UI can update the active tool without knowledge of tool-specific geometry rules.

#### Scenario: Numeric override changes
- **WHEN** the user edits a numeric control declared by the sketch tool schema
- **THEN** the sketch UI emits the field's declared tool action or patch to the active sketch tool workflow

#### Scenario: Option selection changes
- **WHEN** the user changes an option or mode declared by the sketch tool schema
- **THEN** the sketch UI emits the declared action without interpreting tool-specific construction logic itself

### Requirement: Overlay-oriented elements SHALL be declared explicitly
The sketch tool schema SHALL declare the transient overlays and annotations required by a tool, including staged geometry labels, live dimensions, anchor markers, and completion cues, so the rendering layer can remain generic.

#### Scenario: Displaying staged dimension annotations
- **WHEN** an active sketch tool provides a live dimension annotation through the schema
- **THEN** the generic sketch overlay renderer displays that annotation without knowing the tool-specific geometry algorithm

#### Scenario: Displaying anchor and endpoint cues
- **WHEN** an active sketch tool provides anchor, endpoint, or helper markers through the schema
- **THEN** the generic sketch overlay renderer displays them according to the declared overlay descriptors

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
