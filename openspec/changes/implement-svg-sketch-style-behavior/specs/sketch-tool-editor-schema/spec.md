## ADDED Requirements

### Requirement: Sketch tool schema SHALL support focused style control groups
The sketch tool presentation schema SHALL describe focused style control groups for fill, stroke, fill type, and stroke options so generic sketch UI surfaces can render style controls without SVG-tool-specific React branches.

#### Scenario: Fill controls are focused
- **WHEN** the active sketch style command is fill-focused
- **THEN** the schema exposes only the fill controls and target guidance relevant to that command

#### Scenario: Stroke options are focused
- **WHEN** the active sketch style command is stroke-options-focused
- **THEN** the schema exposes stroke width, cap, join, miter, and dash controls supported by the sketch style contract
