## ADDED Requirements

### Requirement: Notification chrome SHALL use centralized semantic theme tokens
The system MUST render workbench notification chrome from centralized Mantine theme tokens, including the dark overlay surface, borders, text, and semantic information, warning, and danger accents.

#### Scenario: Render typed notification chrome
- **WHEN** an informational, warning, or error notification renders in the workbench shell
- **THEN** its surface, border, text, icon color, and accent treatment resolve from Mantine theme tokens or workbench semantic CSS variables derived from those tokens
- **AND** the component does not introduce raw presentation color literals outside the centralized theme definition

#### Scenario: Retune notification colors
- **WHEN** a developer updates the centralized workbench theme semantic tokens
- **THEN** informational, warning, and error notification presentation inherits the revised colors without editing each notification call site
