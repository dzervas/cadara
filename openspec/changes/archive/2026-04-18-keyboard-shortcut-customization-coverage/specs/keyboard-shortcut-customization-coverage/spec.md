## ADDED Requirements

### Requirement: Shortcut overrides SHALL persist at the user-profile boundary
Shortcut customization SHALL persist user overrides as profile data and SHALL NOT store shortcut preferences in document state or modeling history.

#### Scenario: Load profile overrides
- **WHEN** the workbench starts for a user profile with saved shortcut overrides
- **THEN** the shortcut system merges those overrides into the effective keymap

#### Scenario: Document remains unchanged
- **WHEN** the user changes a shortcut
- **THEN** the active document data and modeling history are not mutated

### Requirement: Users SHALL be able to customize shortcuts
The workbench SHALL provide UI for recording, assigning, disabling, resetting, and restoring shortcuts for customizable commands.

#### Scenario: Remap shortcut
- **WHEN** the user records a valid shortcut for a customizable command and saves
- **THEN** the command uses the new shortcut in execution and display

#### Scenario: Disable shortcut
- **WHEN** the user disables a command shortcut
- **THEN** the command has no assigned profile shortcut until reset or reassigned

#### Scenario: Reset shortcut
- **WHEN** the user resets a command shortcut
- **THEN** the command returns to its default shortcut assignment

### Requirement: Shortcut customization SHALL prevent invalid conflicts
The customization UI SHALL validate proposed shortcuts with the same conflict rules used by the effective keymap before saving overrides.

#### Scenario: Duplicate conflict warning
- **WHEN** the user records a shortcut already assigned to another command in an overlapping scope
- **THEN** the UI reports the conflict and does not save the invalid override

#### Scenario: Sequence prefix warning
- **WHEN** the user records a sequence that creates a same-scope prefix ambiguity
- **THEN** the UI reports the ambiguous commands and does not save the invalid override

### Requirement: Command coverage SHALL include major visible workbench actions
The command registry SHALL include command ids for major visible toolbar, context menu, sidebar, timeline, viewport, and selection actions so they can receive shortcuts or appear in shortcut reference surfaces.

#### Scenario: Context menu action command
- **WHEN** a high-value context menu action such as Rename, Delete, Edit, Export, or Roll cursor here is available
- **THEN** it has a command id or an explicit non-command rationale

#### Scenario: Viewport command
- **WHEN** a viewport navigation action is available through visible UI
- **THEN** it can be represented as a command with optional shortcut assignment

### Requirement: Shortcut reference SHALL be generated from registry data
The workbench SHALL provide a shortcut reference or command list generated from command registry and effective keymap data.

#### Scenario: Reference displays customized shortcut
- **WHEN** a user remaps a shortcut
- **THEN** the shortcut reference displays the customized shortcut rather than the default

#### Scenario: Reference groups commands
- **WHEN** the shortcut reference is opened
- **THEN** commands are grouped by command category or workbench area
