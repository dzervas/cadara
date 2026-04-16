## MODIFIED Requirements

### Requirement: The schema SHALL expose the control vocabulary needed by current sketch tools
The schema SHALL include built-in elements for tool prompts, step/status labels, lightweight numeric inputs, option choices, live measurements, completion hints, transient overlay annotations, cursor hints, and floating value-entry prompts needed by current and near-term sketch tools, including constraint authoring flows.

#### Scenario: Constraint tool requests target-picking guidance
- **WHEN** an active constraint operation is waiting for a point, line, arc, or circle selection
- **THEN** the schema can express the current selection step, cursor guidance, and any pending target feedback without requiring custom constraint UI branches

#### Scenario: Constraint tool requires a floating numeric input
- **WHEN** an active dimensional constraint needs an authored value after the required selections are complete
- **THEN** the schema can express the floating value-entry prompt and its bound action contract without requiring bespoke React state outside the sketch runtime

### Requirement: Overlay-oriented elements SHALL be declared explicitly
The sketch tool schema SHALL declare the transient overlays and annotations required by a tool, including staged geometry labels, live dimensions, anchor markers, completion cues, and preview constraint annotations, so the rendering layer can remain generic.

#### Scenario: Displaying preview constraint annotations
- **WHEN** an active constraint operation provides a preview glyph, relationship marker, or dimensional label through the schema
- **THEN** the generic sketch overlay or viewport renderer displays that preview without knowing the operation-specific authoring algorithm

#### Scenario: Displaying anchored selection affordances
- **WHEN** an active constraint operation provides hover or partial-selection markers through the schema
- **THEN** the generic rendering layer displays those markers according to the declared descriptor payload rather than inferring behavior from tool-specific code
