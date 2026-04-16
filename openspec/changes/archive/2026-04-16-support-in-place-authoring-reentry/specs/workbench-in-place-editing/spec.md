## ADDED Requirements

### Requirement: Double-clicking a committed feature SHALL reopen its edit form
The workbench SHALL reopen a committed feature for in-place editing when the user double-clicks that feature entry, and the resulting edit session SHALL be hydrated from the current committed values.

#### Scenario: Double-click a committed feature
- **WHEN** the user double-clicks a committed feature entry in the workbench tree or timeline context that exposes feature rows
- **THEN** the feature form opens in edit mode for that feature

#### Scenario: Hydrate current committed values
- **WHEN** the reopened feature edit form becomes active
- **THEN** its draft values are prefilled from the current committed feature definition rather than from create-session defaults

### Requirement: Double-clicking a committed sketch SHALL reopen sketch editing in place
The workbench SHALL reopen an existing sketch editor session on a committed sketch when the user double-clicks that sketch entry.

#### Scenario: Double-click a committed sketch
- **WHEN** the user double-clicks a committed sketch entry in the workbench tree
- **THEN** the sketch editor opens on that sketch for continued authoring

#### Scenario: Reopened sketch preserves its authored plane
- **WHEN** the reopened sketch editor session becomes active
- **THEN** the session uses the sketch's stored plane and authored geometry context
