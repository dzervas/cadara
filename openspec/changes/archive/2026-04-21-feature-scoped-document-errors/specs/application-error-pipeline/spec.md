## ADDED Requirements

### Requirement: Recoverable document errors SHALL use non-destructive recovery messaging
The system SHALL surface recoverable feature-scoped document errors as feature diagnostics and SHALL NOT present clearing, deleting, resetting, or starting from scratch as a valid fix for that state.

#### Scenario: Recoverable rebuild failure reaches UI
- **WHEN** a feature-scoped rebuild failure is shown to the user
- **THEN** the visible message directs the user to repair the marked feature field
- **AND** the message does not recommend clearing, deleting, resetting, or starting over the document

#### Scenario: Global fallback is not used for feature error
- **WHEN** a structurally valid document contains a repairable feature error
- **THEN** the error pipeline keeps the failure attached to modeling diagnostics for the feature
- **AND** it does not replace the workbench with a document-level fallback whose only repair action is destructive

#### Scenario: Unexpected application crash remains separate
- **WHEN** an unrelated unexpected React render crash or programmer invariant failure occurs
- **THEN** the application error boundary may still show its standard fallback and reporting behavior
- **AND** that fallback is not used to handle ordinary recoverable feature rebuild failures
