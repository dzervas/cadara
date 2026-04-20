## MODIFIED Requirements

### Requirement: Debugger is collapsible
The system SHALL allow the unified state debugger to collapse and expand without changing editor, document, command, selection, sketch, or feature edit state. In test mode (indicated by a `cadTestMode` query parameter or `import.meta.env.TEST` flag), the debugger overlay SHALL apply `pointer-events: none` so it does not intercept viewport clicks, eliminating the need for tests to toggle collapse/expand state before viewport interactions.

#### Scenario: User collapses the debugger
- **WHEN** the user activates the debugger collapse control
- **THEN** the overlay hides the detailed state rows while preserving an affordance to expand it again

#### Scenario: User expands the debugger
- **WHEN** the user activates the debugger expand control
- **THEN** the overlay restores the detailed state rows using the current editor state

#### Scenario: Test mode disables pointer interception
- **WHEN** the application runs with the test mode flag active
- **THEN** the state debugger overlay has `pointer-events: none` and does not intercept clicks on the underlying viewport surface
