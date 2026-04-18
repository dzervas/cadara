## ADDED Requirements

### Requirement: Toolbar tooltips SHALL show effective shortcuts
Toolbar tooltips SHALL show the active shortcut for a tool when that tool has an assigned shortcut in the effective keymap.

#### Scenario: Tool shortcut visible
- **WHEN** the user hovers a toolbar tool with an assigned shortcut
- **THEN** the tooltip shows the tool name, shortcut hint, and description

#### Scenario: Unassigned tool shortcut hidden
- **WHEN** the user hovers a toolbar tool whose shortcut is disabled or unassigned
- **THEN** the tooltip does not show a stale default shortcut

### Requirement: Dropdown and search results SHALL show shortcut hints
Toolbar dropdown variant rows and tool search results SHALL show shortcut hints from the effective keymap when available.

#### Scenario: Dropdown variant shortcut
- **WHEN** a dropdown-backed tool menu is rendered
- **THEN** each variant with an assigned shortcut shows that shortcut beside its label

#### Scenario: Search result shortcut
- **WHEN** tool search results are rendered
- **THEN** each result with an assigned shortcut shows that shortcut in the result row

### Requirement: Context menu entries SHALL support command shortcut hints
Workbench context menu entries SHALL support an optional command id and SHALL render the command shortcut on the right side of the row when assigned.

#### Scenario: Context menu command shortcut
- **WHEN** a context menu item has a command id with an effective shortcut
- **THEN** the menu row shows the item label and right-aligned shortcut hint

#### Scenario: Context menu item without command id
- **WHEN** a context menu item has no command id
- **THEN** the menu row renders without a shortcut hint

### Requirement: Shortcut hint rendering SHALL be generated from the effective keymap
Shortcut hints SHALL be generated from normalized effective keymap data rather than handwritten into labels, descriptions, or menu text.

#### Scenario: Remapped shortcut display
- **WHEN** the effective keymap returns a non-default shortcut for a command
- **THEN** all shortcut hint surfaces display the effective shortcut value
