# toolbar-tool-presentation Specification

## Purpose
TBD - created by archiving change use-svg-toolbar-icons-and-rich-tooltips. Update Purpose after archive.
## Requirements
### Requirement: Toolbar tools render configured local SVG icons
The system MUST render every toolbar tool button and toolbar dropdown variant with a configured SVG asset from the local `public/icons` set instead of a `lucide-react` icon component.

#### Scenario: Render a standard toolbar feature tool
- **WHEN** the workbench renders a non-dropdown toolbar tool such as `Extrude`
- **THEN** the button uses the configured local SVG asset for that tool
- **AND** the rendered icon does not depend on a `lucide-react` glyph for that toolbar tool

#### Scenario: Render a dropdown family and its variants
- **WHEN** the workbench renders a dropdown-backed toolbar tool such as `Pattern` and opens its menu
- **THEN** the dropdown trigger uses the configured local SVG asset for the family entry
- **AND** each listed variant uses its configured local SVG asset in the menu row

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

### Requirement: Toolbar tool foreground SHALL remain visible in sketch mode
The system SHALL render toolbar tool icons and foreground affordances with sufficient contrast against the dark workbench shell in both part mode and sketch mode.

#### Scenario: Sketch toolbar tools are visible
- **WHEN** the user enters sketch mode
- **THEN** each visible toolbar tool icon uses a light or otherwise high-contrast foreground treatment against the toolbar background

#### Scenario: Dropdown sketch tools are visible
- **WHEN** a sketch-mode dropdown tool family is rendered or opened
- **THEN** both the dropdown trigger icon and each variant icon remain visible against their dark shell surfaces

### Requirement: SVG style toolbar controls SHALL reflect sketch style availability
The toolbar SHALL present SVG/style controls with active and disabled states that reflect whether the current sketch selection can receive local style edits.

#### Scenario: Style target is selected
- **WHEN** the user is editing a sketch and has selected a local styleable sketch point or entity
- **THEN** SVG/style toolbar controls are available and can focus the relevant style controls

#### Scenario: No style target is selected
- **WHEN** the user is editing a sketch without a styleable local target selected
- **THEN** SVG/style toolbar controls do not imply that a style mutation has already been applied

