## ADDED Requirements

### Requirement: DocumentRepository SHALL preserve repairable semi-broken documents
The repository restore path SHALL preserve structurally valid authored documents that contain repairable feature rebuild errors and SHALL NOT clear, delete, reset, or replace them as a recovery action.

#### Scenario: Restore repairable broken document
- **WHEN** the repository loads a structurally valid authored document whose later feature cannot rebuild
- **THEN** the repository exposes the authored document to the modeling service
- **AND** it does not seed an empty replacement document
- **AND** it does not remove the broken feature from authored history

#### Scenario: Recovery does not reset storage
- **WHEN** a recoverable feature-scoped document error is detected during startup
- **THEN** `DocumentRepository` preserves the persisted authored document state
- **AND** no repository reset, clear, or delete operation is invoked as part of recovery

#### Scenario: Explicit reset remains separate
- **WHEN** a user independently invokes an explicit document reset command outside feature-error recovery
- **THEN** that command remains a distinct user action
- **AND** recoverable document error messaging does not present reset as the fix
