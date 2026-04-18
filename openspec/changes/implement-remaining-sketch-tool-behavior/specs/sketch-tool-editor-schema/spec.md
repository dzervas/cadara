## ADDED Requirements

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
