# editor-runtime-orchestration Specification

## Purpose

Define the editor runtime orchestration model, including the reducer-driven event loop, async effect sequencing, cursor sequencing, and application/runtime ownership boundaries.
## Requirements
### Requirement: Editor runtime SHALL use explicit statechart-owned orchestration for command workflows
The editor runtime SHALL orchestrate command workflows through an explicit event loop and pure reducer rather than through an xstate statechart/actor model. The event loop SHALL dispatch events through the pure transition function, manage an effect queue, execute effects serially, and feed results back through the transition function.

#### Scenario: Runtime enters an active command workflow
- **WHEN** the user activates a tool that opens a command workflow
- **THEN** the editor event loop dispatches the tool activation event through the pure transition function
- **AND** the resulting state reflects the corresponding workflow kind

#### Scenario: Runtime manages an async command effect
- **WHEN** a command workflow requires async work such as snapshot loading, sketch open, feature hydration, preview evaluation, or commit execution
- **THEN** that work is queued as a typed effect and executed serially by the event loop's effect executor
- **AND** the effect result is dispatched back through the pure transition function

### Requirement: Editor runtime SHALL preserve current effect-ordering and stale-result safety
The editor runtime SHALL preserve current command correlation, effect ordering, and stale-result rejection behavior after the orchestration migration.

#### Scenario: Stale preview response arrives
- **WHEN** an async response arrives for an outdated command or request basis
- **THEN** the pure transition function safely ignores or rejects that stale result instead of mutating the active command state

#### Scenario: Command is cancelled while async work is in flight
- **WHEN** the user cancels a command with in-flight async work
- **THEN** the event loop continues processing the in-flight effect but the pure transition function rejects the stale result when it arrives

### Requirement: Orchestration migration SHALL allow React `useEffect` reduction in the editor runtime layer
The editor runtime SHALL allow React `useEffect` usage to be reduced or removed where those effects exist only to orchestrate state-machine side effects, while leaving non-orchestration DOM and resource lifecycle effects outside the event loop.

#### Scenario: Session bootstrap is event-loop-owned
- **WHEN** the editor runtime needs to bootstrap its initial session behavior
- **THEN** that bootstrap is owned by the event loop's `start` method which dispatches the initial `session.started` event
- **AND** no React `useEffect` is needed solely for dispatching the initial runtime event

#### Scenario: DOM lifecycle effect remains outside the runtime machine
- **WHEN** a component owns a browser or DOM lifecycle concern that is not command orchestration
- **THEN** that concern may remain in React rather than being forced into the editor event loop

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

### Requirement: Editor runtime and application controllers SHALL preserve explicit ownership boundaries
The system SHALL keep editor session state, command-session sequencing, and document cursor sequencing in the editor runtime while assigning browser-facing coordination and command entry selection to application-layer controllers.

#### Scenario: Toolbar action opens an editor command
- **WHEN** the user activates a tool that starts or changes an editor command workflow
- **THEN** an application-layer controller selects the appropriate shared command entrypoint
- **AND** the resulting editor event is dispatched through the editor event loop
- **AND** the runtime remains the owner of command-session state

#### Scenario: Browser-facing coordination is required
- **WHEN** a command flow needs browser-facing coordination such as a file picker, shortcut dispatch mapping, or workbench notification
- **THEN** that coordination is handled by an application-layer controller
- **AND** the editor event loop is not used as the owner of that browser-specific flow

### Requirement: Editor runtime SHALL own sequencing for covered workbench document mutations
For workbench flows covered by this change, the editor runtime SHALL own accepted mutation sequencing and follow-up refresh sequencing instead of relying on application controllers to mutate the modeling service directly and repair state afterward.

#### Scenario: Runtime-owned workbench mutation completes
- **WHEN** a covered workbench mutation such as rename, variable update, or import completion is accepted
- **THEN** the editor runtime sequences the resulting refresh or state transition
- **AND** application controllers do not finalize the flow by issuing a separate repair refresh

#### Scenario: Covered workbench mutation fails
- **WHEN** a covered workbench mutation fails or conflicts
- **THEN** the editor runtime preserves authoritative command and refresh state
- **AND** application controllers are limited to surfacing feedback instead of patching editor state directly

### Requirement: Runtime-owned refresh handoff SHALL distinguish incremental mutation from document replacement
The editor runtime SHALL expose distinct sequencing behavior for ordinary incremental mutations versus explicit whole-document replacement flows.

#### Scenario: Incremental mutation refreshes current document basis
- **WHEN** a covered incremental mutation succeeds
- **THEN** the runtime refreshes or advances the current document basis without treating the flow as full document replacement

#### Scenario: Whole-document replacement is requested
- **WHEN** the application requests replacement of the active document basis
- **THEN** the runtime processes that request through an explicit replacement handoff
- **AND** the replacement path is not reused as the generic completion path for ordinary workbench mutations

### Requirement: Editor runtime SHALL expose passive debug trace observation
The editor runtime SHALL expose passive observability for recent event, effect, and accepted-state sequencing so development-only tooling can inspect runtime causality without making the runtime the owner of browser globals or debug transport.

#### Scenario: Runtime dispatches an event
- **WHEN** the editor event loop dispatches an editor event
- **THEN** development-only observers can receive structured trace data describing the event, resulting transition, and any emitted effects
- **AND** the runtime continues to own the sequencing of those transitions

#### Scenario: Effect completes or fails
- **WHEN** an editor effect completes successfully or fails
- **THEN** development-only observers can receive structured trace data describing the completion or failure and the resulting follow-up transition
- **AND** the runtime does not write that trace directly to browser globals

#### Scenario: No debug observer is installed
- **WHEN** no development-only debug observer is active
- **THEN** the runtime continues normal event-loop behavior
- **AND** the absence of an observer does not change command or effect sequencing

