## ADDED Requirements

### Requirement: The workbench SHALL use a centralized dark-first Mantine theme
The system MUST initialize workbench chrome from a single shared Mantine theme module that defaults to dark mode and exposes the color tuple used by toolbar, sidebar, inspector, menus, and form-like controls.

#### Scenario: Start the workbench
- **WHEN** the application renders the workbench shell
- **THEN** Mantine components receive a shared dark theme configuration from one central module
- **AND** the shell does not require per-component CSS variables to establish its primary palette

#### Scenario: Retune the shell palette
- **WHEN** a developer updates the centralized Mantine color tuple
- **THEN** the toolbar, sidebar, inspector, menus, and other standard shell controls inherit the revised colors from the shared theme
- **AND** the change does not require editing each component's local color literals

### Requirement: Standard workbench controls SHALL prefer Mantine primitives over bespoke shell wrappers
The system MUST implement standard workbench chrome with Mantine components or Mantine theme styling whenever Mantine provides the needed interaction without increasing code complexity.

#### Scenario: Render standard shell controls
- **WHEN** the workbench renders controls such as toolbar buttons, search inputs, dropdown menus, tooltips, scroll containers, and panel surfaces
- **THEN** those controls use Mantine primitives or Mantine theme styling as their default implementation path

#### Scenario: Render a viewport-specific interaction
- **WHEN** a control is tightly coupled to the Three.js viewport or another interaction Mantine does not cover cleanly
- **THEN** the system may keep a custom implementation for that viewport-owned surface
- **AND** the surrounding shell controls still follow the Mantine-first rule

### Requirement: Styling simplification SHALL take priority over decorative parity
The system MUST prefer a shorter Mantine-driven implementation over preserving non-essential decorative styling when behavior, density, and dark workbench character remain intact.

#### Scenario: Migrate a shell surface with decorative styling
- **WHEN** a toolbar button, panel, menu, or similar shell surface is migrated
- **THEN** the implementation may drop custom gradients, layered shadows, or similar eye candy
- **AND** the migrated surface keeps the same behavioral contract and dense dark workbench tone

#### Scenario: Evaluate remaining custom CSS
- **WHEN** the migration is complete
- **THEN** non-Mantine custom CSS is limited to global reset, root sizing, and viewport-specific rendering surfaces
- **AND** standard shell components do not depend on bespoke CSS files for their default appearance
