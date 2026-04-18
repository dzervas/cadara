## Purpose
Define the command registry, shortcut parsing, keymap merging, conflict detection, and resolver behavior that all workbench keyboard shortcuts build on.

## Requirements

### Requirement: Commands SHALL be addressable independently of UI components
The system SHALL define keyboard-addressable workbench behavior as commands with stable ids, user-facing labels, categories, scopes, default shortcuts, and customization metadata.

#### Scenario: Tool command derivation
- **WHEN** the command registry is built
- **THEN** toolbar tool commands can be derived from the existing tool definitions without duplicating tool labels and modes

#### Scenario: Non-tool command declaration
- **WHEN** an editor behavior such as cancel, undo, redo, or search focus is registered
- **THEN** it can be represented as a command even when no toolbar tool exists for it

### Requirement: Shortcuts SHALL parse from logical key values
The shortcut parser SHALL normalize shortcut definitions and keyboard events using `event.key` values rather than physical `event.code` values.

#### Scenario: Modifier chord parses
- **WHEN** the system parses `mod+shift+z`
- **THEN** it produces a normalized shortcut chord with `mod`, `shift`, and logical key `z`

#### Scenario: Sequence parses
- **WHEN** the system parses `g>f`
- **THEN** it produces an ordered two-step shortcut sequence using logical keys `g` and `f`

### Requirement: Shortcut display SHALL come from normalized keymap data
The system SHALL format shortcut definitions for display from the same normalized keymap data used for shortcut resolution.

#### Scenario: Platform modifier formatting
- **WHEN** the system formats the `mod+z` shortcut on a Mac platform
- **THEN** it displays a Command-style modifier label
- **AND** on non-Mac platforms it displays a Ctrl-style modifier label

#### Scenario: Sequence formatting
- **WHEN** the system formats a multi-key sequence
- **THEN** the rendered label preserves the ordered sequence steps

### Requirement: Effective keymaps SHALL support profile overrides
The system SHALL compute an effective keymap by merging default command shortcuts with user-profile override data without storing shortcut preferences in document state.

#### Scenario: Default shortcut used
- **WHEN** a command has no profile override
- **THEN** the effective keymap uses the command default shortcuts

#### Scenario: Shortcut disabled by profile
- **WHEN** a command profile override is an empty shortcut list
- **THEN** the effective keymap treats the command as unassigned

### Requirement: Shortcut conflicts SHALL be detectable
The system SHALL detect duplicate and ambiguous shortcut bindings within overlapping active scopes before they are used by the resolver.

#### Scenario: Duplicate same-scope shortcut
- **WHEN** two enabled commands bind the same shortcut in the same scope
- **THEN** conflict detection reports both command ids and the conflicting shortcut

#### Scenario: Prefix sequence conflict
- **WHEN** one command binds `g` and another same-scope command binds `g>f`
- **THEN** conflict detection reports an ambiguous prefix conflict

### Requirement: Shortcut resolver SHALL dispatch the highest-priority enabled command
The shortcut resolver SHALL match keyboard events against the effective keymap, active scopes, sequence state, text-editing guards, and command enablement before executing a command.

#### Scenario: Text input guard
- **WHEN** focus is inside an input, textarea, select, or contenteditable target
- **THEN** printable command shortcuts do not execute unless the command explicitly allows text-editing targets

#### Scenario: Scoped command resolution
- **WHEN** the same shortcut is available in a lower-priority and higher-priority active scope
- **THEN** the resolver executes the enabled command from the higher-priority scope
