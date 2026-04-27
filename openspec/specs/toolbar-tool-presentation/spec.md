# toolbar-tool-presentation Specification

## Purpose
TBD - created by archiving change use-svg-toolbar-icons-and-rich-tooltips. Update Purpose after archive.
## Requirements
### Requirement: Toolbar tools render configured local SVG icons
The system MUST render every toolbar tool button and toolbar dropdown variant with a configured SVG asset from the shared tool icon definition source instead of a `lucide-react` icon component or toolbar-local asset map.

#### Scenario: Render a standard toolbar feature tool
- **WHEN** the workbench renders a non-dropdown toolbar tool such as `Extrude`
- **THEN** the button uses the configured local SVG asset for that tool from the shared tool icon definition source
- **AND** the rendered icon does not depend on a `lucide-react` glyph for that toolbar tool

#### Scenario: Render a dropdown family and its variants
- **WHEN** the workbench renders a dropdown-backed toolbar tool such as `Pattern` and opens its menu
- **THEN** the dropdown trigger uses the configured local SVG asset for the family entry from the shared tool icon definition source
- **AND** each listed variant uses its configured local SVG asset from the same source in the menu row

#### Scenario: Preserve current toolbar icon choices
- **WHEN** the toolbar resolves icons after centralization
- **THEN** every existing toolbar `ToolIconId` maps to the same local SVG asset filename it used before centralization

### Requirement: Toolbar tooltips separate feature name from description
The system MUST render toolbar tooltips with the tool name as a distinct heading above the descriptive tooltip copy for every toolbar button that exposes a tooltip.

#### Scenario: Hover a standard toolbar button
- **WHEN** the user hovers a toolbar button such as `Extrude`
- **THEN** the tooltip shows `Extrude` as the feature title
- **AND** the tooltip shows the descriptive copy on a separate line beneath the title

#### Scenario: Hover a dropdown trigger button
- **WHEN** the user hovers a dropdown trigger such as `Pattern`
- **THEN** the tooltip shows the trigger tool name as the title
- **AND** the tooltip shows the descriptive copy beneath it using the same layout as standard toolbar buttons

### Requirement: Toolbar SHALL present tools with icons and tooltips
The toolbar SHALL display tool icons with descriptive tooltips. The import tool group SHALL contain a single generic `import` tool available in part mode.

#### Scenario: Import tool visible in part mode
- **WHEN** the toolbar renders in part mode
- **THEN** an import button is visible in the import tool group
- **AND** the tooltip describes generic file import, not a specific format

#### Scenario: Import tool hidden in sketch mode
- **WHEN** the toolbar renders in sketch mode
- **THEN** the import button is not visible

### Requirement: Toolbar tool foreground SHALL remain visible in sketch mode
The system SHALL render toolbar tool icons and foreground affordances with sufficient contrast against the dark workbench shell in both part mode and sketch mode.

#### Scenario: Sketch toolbar tools are visible
- **WHEN** the user enters sketch mode
- **THEN** each visible toolbar tool icon uses a light or otherwise high-contrast foreground treatment against the toolbar background

#### Scenario: Dropdown sketch tools are visible
- **WHEN** a sketch-mode dropdown tool family is rendered or opened
- **THEN** both the dropdown trigger icon and each variant icon remain visible against their dark shell surfaces

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
