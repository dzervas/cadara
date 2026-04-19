## ADDED Requirements

### Requirement: Combine feature SHALL expose explicit body boolean authoring
The system SHALL provide a user-facing Combine feature that collects explicit target bodies, explicit tool bodies, and one boolean operation mode before preview or commit.

#### Scenario: Combine create session opens from toolbar
- **WHEN** the user activates the part-mode Combine toolbar tool
- **THEN** the workbench opens a Combine create session instead of only dispatching a toolbar log event

#### Scenario: Combine records target and tool bodies separately
- **WHEN** the user selects durable bodies for a Combine operation
- **THEN** the draft stores selected target bodies separately from selected tool bodies
- **AND** the feature definition does not infer participant roles from viewport selection order alone

#### Scenario: Combine operation mode is explicit
- **WHEN** the user configures a Combine session
- **THEN** the session exposes `add`, `subtract`, and `intersect` operation modes
- **AND** the resulting feature definition stores the selected operation intent

### Requirement: Combine feature SHALL preview and commit body boolean results
The system SHALL evaluate Combine previews and commits through the modeling boundary and return visible geometry changes for valid body boolean operations.

#### Scenario: Preview valid Combine
- **WHEN** a Combine draft has at least one target body, at least one tool body, and a supported operation mode
- **THEN** preview returns transient renderables that reflect the requested body boolean operation
- **AND** the committed document state remains unchanged

#### Scenario: Commit valid Combine
- **WHEN** the user commits a valid Combine draft
- **THEN** the modeling service persists a Combine feature in the feature timeline
- **AND** the resulting snapshot and viewport render the boolean result rather than the unchanged pre-combine body set

#### Scenario: Edit committed Combine
- **WHEN** the user opens a committed Combine feature for editing
- **THEN** the editor hydrates target bodies, tool bodies, and operation mode from the durable feature definition

### Requirement: Combine feature SHALL surface actionable diagnostics
The system SHALL reject incomplete or invalid Combine inputs with structured diagnostics and without mutating the durable document.

#### Scenario: Missing target body
- **WHEN** preview or commit is requested for a Combine draft without a target body
- **THEN** the session reports a diagnostic requiring at least one target body
- **AND** no feature mutation is committed

#### Scenario: Missing tool body
- **WHEN** preview or commit is requested for a Combine draft without a tool body
- **THEN** the session reports a diagnostic requiring at least one tool body
- **AND** no feature mutation is committed

#### Scenario: Empty boolean result
- **WHEN** the kernel evaluates a Combine operation whose result contains no usable solid output
- **THEN** the response reports an empty-result diagnostic
- **AND** the workbench does not silently preserve the pre-combine geometry as if the operation succeeded

