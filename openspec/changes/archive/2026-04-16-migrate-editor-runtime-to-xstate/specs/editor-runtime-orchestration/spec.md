## ADDED Requirements

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
