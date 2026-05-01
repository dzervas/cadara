# tea-editor-event-loop Specification

## Purpose

Define the framework-agnostic editor event loop that dispatches pure reducer events, executes effects serially, and exposes a thin integration seam for React.

## Requirements

### Requirement: Editor event loop SHALL dispatch events through the pure reducer
The editor event loop SHALL accept `EditorEvent` values via a `dispatch` method and apply them to the current `EditorState` by calling the pure transition function, producing a new state and zero or more effect requests.

#### Scenario: Dispatch a synchronous event
- **WHEN** a consumer calls `dispatch` with an `EditorEvent`
- **THEN** the event loop calls the pure transition function with the current state, the event, and the configured dependencies
- **AND** the resulting `EditorState` becomes the new current state
- **AND** all registered subscribers are notified with the new state

#### Scenario: Dispatch produces no effects
- **WHEN** the transition function returns an empty effects array
- **THEN** no async work is initiated
- **AND** the event loop remains ready for the next dispatch

### Requirement: Editor event loop SHALL execute effects serially and feed results back
The editor event loop SHALL process effects one at a time in FIFO order, execute each through the configured effect executor, and dispatch the resulting event back through the pure transition function.

#### Scenario: Single effect is produced
- **WHEN** a transition produces one effect
- **THEN** the event loop executes that effect via the configured effect executor
- **AND** the resulting event is dispatched back through the transition function
- **AND** any further effects from that transition are appended to the queue

#### Scenario: Multiple effects are queued
- **WHEN** a transition produces multiple effects
- **THEN** the event loop processes them in FIFO order
- **AND** each effect completes before the next begins execution

#### Scenario: Effect execution chain
- **WHEN** an effect result event produces additional effects
- **THEN** those effects are appended to the end of the queue
- **AND** they are processed in order after any previously queued effects

### Requirement: Editor event loop SHALL handle effect execution errors without crashing
The editor event loop SHALL catch errors from effect execution, report them through the configured error reporter, create a typed failure event, and dispatch that failure event through the transition function.

#### Scenario: Effect executor throws
- **WHEN** an effect executor throws or rejects
- **THEN** the event loop normalizes the error and reports it through the error reporter
- **AND** a typed failure event for the effect type is dispatched through the transition function
- **AND** the event loop continues processing remaining queued effects

#### Scenario: Effect executor throws during a chain
- **WHEN** an effect in a chain of queued effects throws
- **THEN** the failure event is dispatched for that specific effect
- **AND** remaining effects in the queue continue to execute normally

### Requirement: Editor event loop SHALL support subscribe and unsubscribe for state changes
The editor event loop SHALL allow consumers to register and unregister state-change listeners.

#### Scenario: Subscriber receives state updates
- **WHEN** a consumer subscribes to the event loop
- **THEN** the subscriber is called with the new state after each transition

#### Scenario: Unsubscribed listener stops receiving
- **WHEN** a consumer unsubscribes
- **THEN** that listener is no longer called on subsequent state changes

### Requirement: Editor event loop SHALL support start and stop lifecycle
The editor event loop SHALL support explicit `start` and `stop` methods for lifecycle management.

#### Scenario: Start dispatches session.started
- **WHEN** the event loop is started
- **THEN** it dispatches a `session.started` event to initialize the editor state

#### Scenario: Stop clears the effect queue
- **WHEN** the event loop is stopped
- **THEN** any pending effects in the queue are discarded
- **AND** no further effect results are dispatched even if an in-flight effect completes

### Requirement: Editor event loop SHALL be framework-agnostic
The editor event loop SHALL not depend on React or any UI framework. A thin React hook SHALL wrap it for provider integration.

#### Scenario: Event loop used without React
- **WHEN** a test or non-React consumer creates an event loop instance
- **THEN** it functions identically to the React-wrapped version
- **AND** no React imports are required
