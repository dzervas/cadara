## MODIFIED Requirements

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
