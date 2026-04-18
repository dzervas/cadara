## ADDED Requirements

### Requirement: Sketch style tools SHALL have explicit activation behavior
Sketch style toolbar tools SHALL have explicit domain-level activation behavior that preserves active sketch editing state and routes to style control presentation instead of generic command selection state.

#### Scenario: Runtime activates a style tool
- **WHEN** the editor activates a sketch SVG/style tool while a sketch session is open
- **THEN** the runtime keeps the active sketch session open
- **AND** it resolves the requested style focus or target guidance through sketch-domain logic
