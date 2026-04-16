# workbench-ui-foundation Specification

## Purpose

Define the shared UI foundation for the workbench so shell components use a centralized dark-first Mantine theme and minimal custom styling.
## Requirements
### Requirement: The workbench SHALL use a centralized dark-first Mantine theme
The system MUST initialize workbench chrome from a single shared Mantine theme module that defaults to dark mode, and Mantine colors MUST be the only source of truth for app-authored presentation colors across toolbar, sidebar, inspector, menus, tooltips, overlays, and other workbench surfaces.

#### Scenario: Start the workbench
- **WHEN** the application renders the workbench shell
- **THEN** Mantine components receive a shared dark theme configuration from one central module
- **AND** shell and overlay presentation colors resolve through Mantine theme tokens instead of per-component color literals or alternate color definitions

#### Scenario: Retune the shell palette
- **WHEN** a developer updates the centralized Mantine color tuple or semantic Mantine color mapping
- **THEN** the toolbar, sidebar, inspector, menus, overlays, and other standard workbench controls inherit the revised colors from the shared theme
- **AND** the change does not require editing each component's local color literals

#### Scenario: Audit app-authored presentation colors
- **WHEN** a developer reviews app-authored UI code for presentation colors
- **THEN** raw hex, `rgb(...)`, `rgba(...)`, `hsl(...)`, and similar color literals are absent outside the centralized theme definition and approved static asset files
- **AND** custom shell variables do not introduce a second presentation-color source separate from Mantine

### Requirement: Standard workbench controls SHALL prefer Mantine primitives over bespoke shell wrappers
The system MUST implement standard workbench chrome with Mantine components or Mantine theme styling whenever Mantine provides the needed interaction without increasing code complexity, and any viewport-owned surface that remains custom MUST still consume Mantine theme colors instead of local color literals.

#### Scenario: Render standard shell controls
- **WHEN** the workbench renders controls such as toolbar buttons, search inputs, dropdown menus, tooltips, scroll containers, and panel surfaces
- **THEN** those controls use Mantine primitives or Mantine theme styling as their default implementation path
- **AND** their surface, border, and emphasis colors resolve from the centralized Mantine theme

#### Scenario: Render a viewport-specific interaction
- **WHEN** a control is tightly coupled to the Three.js viewport or another interaction Mantine does not cover cleanly
- **THEN** the system may keep a custom implementation for that viewport-owned surface
- **AND** the custom surface still resolves its presentation colors from Mantine theme tokens

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

### Requirement: Toolbar tooltips SHALL preserve readable contrast in the dark workbench
The system MUST style toolbar tooltip surfaces and tooltip text from coordinated Mantine theme tokens so tooltip copy remains readable against the dark workbench shell.

#### Scenario: Hover a toolbar button
- **WHEN** the user hovers a toolbar button such as `Extrude`
- **THEN** the tooltip surface, border, title text, and description text all resolve from Mantine theme tokens
- **AND** the title and description remain visually readable against the tooltip background

#### Scenario: Hover a dropdown trigger button
- **WHEN** the user hovers a dropdown trigger such as `Pattern`
- **THEN** the tooltip uses the same Mantine-backed contrast treatment as a standard toolbar button
- **AND** the tooltip preserves the existing title-plus-description content hierarchy

### Requirement: The sketch exit affordance SHALL use semantic success styling
The system MUST present `Finish Sketch` as a semantic success action whenever an active sketch session is present so the user can identify the sketch-exit control immediately.

#### Scenario: Render the toolbar during an active sketch session
- **WHEN** the workbench toolbar renders while a sketch session is active
- **THEN** `Finish Sketch` appears with a success-green treatment derived from Mantine theme colors
- **AND** the control remains in its existing toolbar location and dispatches the same tool action as before

#### Scenario: Leave sketch mode unavailable
- **WHEN** no sketch session is active
- **THEN** `Finish Sketch` is not rendered
- **AND** no neutral toolbar tool inherits the success treatment reserved for the sketch exit action

