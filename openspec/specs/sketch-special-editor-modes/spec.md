# sketch-special-editor-modes Specification

## Purpose
TBD - created by archiving change sketch-special-editor-modes. Update Purpose after archive.
## Requirements
### Requirement: Active sketch sessions SHALL host special editor modes for committed operations
The sketch editor SHALL support special editor modes that are owned by the active sketch session and target committed sketch operations rather than ordinary sketch drawing tools.

#### Scenario: Enter a special mode for a committed sketch operation
- **WHEN** the user opens a supported committed sketch operation in a special editor mode
- **THEN** the active sketch session enters that mode without leaving sketch editing
- **AND** the mode remains associated with the targeted committed operation identity

### Requirement: Special editor modes SHALL be resolved through registered mode definitions
The system SHALL resolve each sketch special editor mode through a dedicated registered mode definition instead of hardcoded mode-specific branches in the viewport or generic sketch UI.

#### Scenario: Runtime resolves a mode definition
- **WHEN** the editor enters a sketch special editor mode
- **THEN** it resolves that mode's behavior through its registered mode definition
- **AND** the generic viewport and panel shells do not branch on mode-specific business logic

### Requirement: Special editor mode definitions SHALL own viewport interaction behavior
Each special editor mode definition SHALL own its own viewport-facing interaction contract, including supported hit targets, hover behavior, click and double-click handling, drag behavior, and transient overlays.

#### Scenario: Mode handles viewport interactions
- **WHEN** an active special editor mode receives viewport interaction events
- **THEN** the mode definition interprets those events through its own interaction contract
- **AND** the generic viewport shell only routes events and renders declared overlays

### Requirement: Special editor modes SHALL expose a structured panel contract
Each special editor mode SHALL expose a structured panel definition that follows the feature editor's sectioned form feel while remaining independent from feature-session business logic and independent from deprecated SVG-tool form components.

#### Scenario: Active mode renders a structured panel
- **WHEN** a sketch special editor mode is active
- **THEN** the sketch UI renders that mode's panel from its declarative panel contract
- **AND** the panel uses sectioned controls and diagnostics presentation consistent with the feature editor's visual structure

### Requirement: Special editor modes SHALL support explicit lifecycle actions
The special editor mode contract SHALL support enter, update, commit, cancel, and exit behavior without relying on viewport-local or ad hoc React-local orchestration.

#### Scenario: User cancels an active mode
- **WHEN** the user cancels an active sketch special editor mode
- **THEN** the mode exits through its explicit lifecycle contract
- **AND** the editor clears mode-specific overlays, picking rules, and transient state

