## ADDED Requirements

### Requirement: Editor runtime and application controllers SHALL preserve explicit ownership boundaries
The system SHALL keep editor session state, command-session sequencing, and document cursor sequencing in the editor runtime while assigning browser-facing coordination and command entry selection to application-layer controllers.

#### Scenario: Toolbar action opens an editor command
- **WHEN** the user activates a tool that starts or changes an editor command workflow
- **THEN** an application-layer controller selects the appropriate shared command entrypoint
- **AND** the resulting editor event is dispatched through the editor runtime
- **AND** the runtime remains the owner of command-session state

#### Scenario: Browser-facing coordination is required
- **WHEN** a command flow needs browser-facing coordination such as a file picker, shortcut dispatch mapping, or workbench notification
- **THEN** that coordination is handled by an application-layer controller
- **AND** the editor runtime is not used as the owner of that browser-specific flow

