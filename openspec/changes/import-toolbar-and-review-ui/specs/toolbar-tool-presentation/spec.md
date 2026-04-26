## MODIFIED Requirements

### Requirement: Toolbar SHALL present tools with icons and tooltips
The toolbar SHALL display tool icons with descriptive tooltips. The import tool group SHALL contain a single generic `import` tool available in part mode.

#### Scenario: Import tool visible in part mode
- **WHEN** the toolbar renders in part mode
- **THEN** an import button is visible in the import tool group
- **AND** the tooltip describes generic file import, not a specific format

#### Scenario: Import tool hidden in sketch mode
- **WHEN** the toolbar renders in sketch mode
- **THEN** the import button is not visible
