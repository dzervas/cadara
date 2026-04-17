## ADDED Requirements

### Requirement: Toolbar tool foreground SHALL remain visible in sketch mode
The system SHALL render toolbar tool icons and foreground affordances with sufficient contrast against the dark workbench shell in both part mode and sketch mode.

#### Scenario: Sketch toolbar tools are visible
- **WHEN** the user enters sketch mode
- **THEN** each visible toolbar tool icon uses a light or otherwise high-contrast foreground treatment against the toolbar background

#### Scenario: Dropdown sketch tools are visible
- **WHEN** a sketch-mode dropdown tool family is rendered or opened
- **THEN** both the dropdown trigger icon and each variant icon remain visible against their dark shell surfaces
