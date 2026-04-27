## ADDED Requirements

### Requirement: Editor runtime SHALL orchestrate sketch special editor modes
The editor runtime SHALL own the lifecycle of sketch special editor modes, including activation from an active sketch session, mode-local event routing, cancellation, and stale-result safety for any asynchronous mode work.

#### Scenario: Runtime activates a sketch special editor mode
- **WHEN** an active sketch session requests entry into a supported special editor mode
- **THEN** the editor runtime activates that mode as sketch-owned workflow state
- **AND** the runtime preserves the surrounding sketch session instead of switching to a feature or import workflow

#### Scenario: Runtime cancels a mode with in-flight asynchronous work
- **WHEN** a sketch special editor mode is cancelled while it has in-flight asynchronous work
- **THEN** the runtime cancels or ignores stale mode results according to the mode lifecycle
- **AND** stale results do not mutate the active sketch editor state after exit
