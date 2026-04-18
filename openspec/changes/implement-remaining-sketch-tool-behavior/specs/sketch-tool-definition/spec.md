## ADDED Requirements

### Requirement: Sketch tool definitions SHALL support multi-point curve authoring
Sketch drawing tool definitions SHALL support tools whose valid interaction requires more than two points and whose staged geometry changes after each accepted point.

#### Scenario: Spline tool collects multiple points
- **WHEN** a registered spline tool receives repeated valid point placements
- **THEN** its tool definition updates staged spline preview geometry after each placement
- **AND** it reports when the spline has enough points to complete

### Requirement: Sketch edit tools SHALL have explicit domain definitions
Sketch edit tools that mutate existing geometry SHALL have domain-level definitions for metadata, activation, selection requirements, validation, preview, and accepted draft mutation behavior.

#### Scenario: Runtime activates an edit tool
- **WHEN** the editor activates `trim` or `offset` while a sketch session is open
- **THEN** the runtime resolves an explicit edit-tool behavior instead of falling through to generic selection-command state
