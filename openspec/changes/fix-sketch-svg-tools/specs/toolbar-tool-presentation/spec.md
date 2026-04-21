## MODIFIED Requirements

### Requirement: SVG style toolbar controls SHALL reflect sketch style availability
The toolbar SHALL present SVG/style controls with active and disabled states that reflect the active sketch's SVG rendering setting and whether the current sketch selection can receive the requested style edit. In sketch mode, the toolbar-visible SVG style tools SHALL be limited to Fill and Stroke, with fill type and stroke options available only inside their respective tool forms.

#### Scenario: SVG rendering toggle is shown in sketch mode
- **WHEN** the user is editing a sketch
- **THEN** the sketch toolbar shows an SVG rendering toggle for the active sketch
- **AND** the toggle state reflects the active sketch's saved SVG rendering setting

#### Scenario: SVG rendering is disabled
- **WHEN** the active sketch's SVG rendering toggle is off
- **THEN** Fill and Stroke toolbar actions are unavailable for style editing
- **AND** authored SVG fill and stroke rendering is suppressed for the active sketch

#### Scenario: Fill target is selected
- **WHEN** the user is editing a sketch with SVG rendering enabled and has selected an enclosed region
- **THEN** the Fill toolbar control is available and can focus the Fill form

#### Scenario: Stroke target is selected
- **WHEN** the user is editing a sketch with SVG rendering enabled and has selected a local sketch edge
- **THEN** the Stroke toolbar control is available and can focus the Stroke form

#### Scenario: No compatible style target is selected
- **WHEN** the user is editing a sketch without a compatible target for Fill or Stroke
- **THEN** the corresponding SVG/style toolbar control does not imply that a style mutation has already been applied

#### Scenario: SVG style variants are not toolbar tools
- **WHEN** the user is editing a sketch
- **THEN** the sketch toolbar does not show separate fill type, fill solid, fill gradient, stroke options, stroke width, stroke cap, stroke join, stroke miter, or stroke dash tools
