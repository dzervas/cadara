# developer-debug-platform Specification

## Purpose
TBD - created by archiving change formalize-agent-debug-platform. Update Purpose after archive.
## Requirements
### Requirement: Dev-only debug platform SHALL expose a typed browser namespace
The system SHALL expose a typed dev-only debug namespace on `window` that gives local developers, Playwright tests, and coding agents access to structured workbench state, bounded runtime trace data, and supported debug actions without scraping the DOM.

#### Scenario: Agent reads structured state
- **WHEN** a coding agent evaluates the dev debug namespace in a local dev or test build
- **THEN** it can read the current structured workbench state, including command, selection, revision, and active-session fields, from the namespace
- **AND** the namespace shape is documented and stable for supported local debugging workflows

#### Scenario: Agent reads runtime trace
- **WHEN** a coding agent or local developer requests the current runtime trace from the dev debug namespace
- **THEN** the returned trace contains bounded structured entries describing recent events, effects, and accepted-state transitions
- **AND** the trace order matches the event-loop sequencing order observed by the runtime

#### Scenario: Agent performs a supported debug action
- **WHEN** a coding agent invokes a supported debug action such as selecting a target or dispatching a documented debug request through the namespace
- **THEN** the action routes through the same authoritative application and runtime contracts used by the workbench
- **AND** the namespace does not bypass those ownership boundaries through direct shell-local mutation

### Requirement: Dev-only debug platform SHALL support exported local debug sessions
The system SHALL allow local developers or coding agents to export a bounded debug session containing structured state, runtime trace context, and related debugging metadata suitable for later inspection or replay-oriented tooling.

#### Scenario: Developer exports a local debug session
- **WHEN** a developer or coding agent requests a debug-session export in a dev or test build
- **THEN** the system generates a bounded artifact containing the current structured state and available runtime trace data
- **AND** the artifact format is independent from any single UI surface such as the viewport state overlay

#### Scenario: Session export includes unsupported steps
- **WHEN** a session contains browser-coordination steps that cannot be deterministically replayed
- **THEN** the exported session marks those steps explicitly as unsupported or non-replayable
- **AND** the rest of the session remains inspectable

### Requirement: Dev-only debug platform SHALL remain absent from production builds
The system SHALL gate the debug namespace, exported debug actions, and any local replay entrypoints behind dev or test build conditions so production builds do not expose the platform.

#### Scenario: Production build omits debug namespace
- **WHEN** the application runs from a production build
- **THEN** the dev debug namespace is `undefined`
- **AND** production bundles do not expose the agent-facing debug actions

### Requirement: Local debug browser workflow SHALL provide a dedicated browser attach path
The local development workflow SHALL provide a dedicated debug-browser path that local humans and coding agents can attach to from Docker-based development environments without making the frontend app own browser lifecycle.

#### Scenario: Agent attaches from Docker
- **WHEN** a coding agent running in the local Docker environment needs browser access for debugging
- **THEN** the development workflow provides a dedicated browser endpoint reachable from the agent container
- **AND** the frontend app remains reachable through its normal development service address

#### Scenario: Browser transport remains outside app ownership
- **WHEN** the debug browser is started or restarted
- **THEN** its lifecycle is owned by the local development workflow rather than by the frontend runtime
- **AND** the app only exposes its dev debug contract after the page loads

