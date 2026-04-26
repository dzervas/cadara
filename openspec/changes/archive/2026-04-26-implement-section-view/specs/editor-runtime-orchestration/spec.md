## ADDED Requirements

### Requirement: Temporary inspect workflows SHALL be editor-runtime owned command sessions
The editor runtime SHALL own temporary inspect-style workflows such as section view activation, seed collection, active manipulation, and cancellation instead of delegating that lifecycle to ad hoc React-local state.

#### Scenario: Activate section view from the toolbar
- **WHEN** the user activates the `Section View` tool
- **THEN** the editor runtime enters a section-view command session
- **AND** it installs the section-view seed-selection rules for the viewport

#### Scenario: Accept a section seed
- **WHEN** the user selects an accepted section-view seed
- **THEN** the editor runtime stores the active section plane and retained-side state
- **AND** it transitions the section-view command session from seed collection to active manipulation without mutating durable document geometry

#### Scenario: Cancel or clear an active section
- **WHEN** the user cancels section view or clears the active section
- **THEN** the editor runtime exits the section-view command session
- **AND** it removes section-specific selection rules and temporary section state
