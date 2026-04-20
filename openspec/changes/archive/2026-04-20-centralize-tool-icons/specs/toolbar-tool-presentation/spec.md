## MODIFIED Requirements

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
