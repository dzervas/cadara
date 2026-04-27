# editor-runtime-orchestration Specification

## Purpose
TBD - created by archiving change migrate-editor-runtime-to-xstate. Update Purpose after archive.
## Requirements
### Requirement: Editor runtime SHALL use explicit statechart-owned orchestration for command workflows
The editor runtime SHALL orchestrate command workflows through an explicit statechart/actor model rather than through a custom reducer-plus-effect-runner loop.

#### Scenario: Runtime enters an active command workflow
- **WHEN** the user activates a tool that opens a command workflow
- **THEN** the editor runtime enters the corresponding explicit orchestration state for that command flow

#### Scenario: Runtime manages an async command effect
- **WHEN** a command workflow requires async work such as snapshot loading, sketch open, feature hydration, preview evaluation, or commit execution
- **THEN** that work is owned by the runtime statechart/actor lifecycle rather than by an external React effect flush loop

### Requirement: Editor runtime SHALL preserve current effect-ordering and stale-result safety
The editor runtime SHALL preserve current command correlation, effect ordering, and stale-result rejection behavior after the orchestration migration.

#### Scenario: Stale preview response arrives
- **WHEN** an async response arrives for an outdated command or request basis
- **THEN** the editor runtime safely ignores or rejects that stale result instead of mutating the active command state

#### Scenario: Command is cancelled while async work is in flight
- **WHEN** the user cancels a command with in-flight async work
- **THEN** the runtime orchestration cancels or ignores that in-flight work according to the command lifecycle

### Requirement: Orchestration migration SHALL allow React `useEffect` reduction in the editor runtime layer
The editor runtime SHALL allow React `useEffect` usage to be reduced or removed where those effects exist only to orchestrate state-machine side effects, while leaving non-orchestration DOM and resource lifecycle effects outside the statechart.

#### Scenario: Session bootstrap is runtime-owned
- **WHEN** the editor runtime needs to bootstrap its initial session behavior
- **THEN** that bootstrap can be owned by the statechart lifecycle rather than by a React `useEffect` whose only purpose is to dispatch the initial runtime event

#### Scenario: DOM lifecycle effect remains outside the runtime machine
- **WHEN** a component owns a browser or DOM lifecycle concern that is not command orchestration
- **THEN** that concern may remain in React rather than being forced into the editor runtime statechart

### Requirement: Editor runtime SHALL sequence document cursor effects
The editor runtime SHALL own document cursor effect sequencing, stale-result rejection, accepted-result revision updates, and follow-up snapshot refreshes.

#### Scenario: Cursor effect is in flight
- **WHEN** a document cursor effect is in flight
- **THEN** the editor runtime tracks the pending cursor request ID
- **AND** stale cursor responses for other request IDs do not mutate the active editor state

#### Scenario: Accepted cursor effect completes
- **WHEN** an accepted document cursor effect completes
- **THEN** the editor runtime records the returned document revision
- **AND** it requests a fresh snapshot before treating the cursor move as complete

#### Scenario: Cursor effect conflicts
- **WHEN** a document cursor effect completes with a stale revision or repository-head conflict
- **THEN** the editor runtime clears the pending cursor request
- **AND** it requests a fresh snapshot for recovery

### Requirement: Editor view state SHALL expose pending document cursor availability
The editor view state SHALL expose document history availability that accounts for pending cursor mutations and pending cursor follow-up snapshot refreshes.

#### Scenario: Pending cursor mutation disables document history actions
- **WHEN** a document cursor mutation or its follow-up snapshot refresh is pending
- **THEN** document-level history Undo and Redo are unavailable in the editor view state

#### Scenario: Cursor refresh completes
- **WHEN** the authoritative snapshot after a cursor mutation is loaded
- **THEN** document-level history Undo and Redo availability is recomputed from the refreshed snapshot

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

