## ADDED Requirements

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
