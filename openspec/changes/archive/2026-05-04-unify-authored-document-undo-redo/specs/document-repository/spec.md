## ADDED Requirements

### Requirement: DocumentRepository SHALL expose plain durable history operations
The system SHALL extend the `DocumentRepository` boundary with plain durable-history operations for local undo/redo availability and application so callers do not depend on Automerge handles, heads, or transaction APIs.

#### Scenario: Runtime queries durable history availability
- **WHEN** application or runtime code needs Undo and Redo availability for the active local document context
- **THEN** it queries the repository through plain durable-history contracts
- **AND** no caller outside the repository receives an Automerge handle, head set, or transaction callback

#### Scenario: Runtime applies a durable history step
- **WHEN** the shared durable-history coordinator requests Undo or Redo
- **THEN** the repository applies the requested local history step through its own persistence implementation
- **AND** the caller receives plain typed result data rather than Automerge internals

### Requirement: DocumentRepository SHALL persist local durable history separately from authored document state
The repository SHALL persist local durable undo/redo metadata on top of its internal local storage substrate while keeping that metadata separate from the canonical authored model document contract.

#### Scenario: Refresh restores local undo and redo availability
- **WHEN** the local editing context records durable history groups and the application refreshes
- **THEN** the repository restores both the authored document and the local durable history metadata for that context
- **AND** Undo and Redo availability after refresh reflects the restored local history state

#### Scenario: Authored document export excludes local durable history metadata
- **WHEN** the modeling boundary exports or validates the canonical authored document
- **THEN** the payload includes only authored CAD state
- **AND** repository-local durable undo metadata is not serialized as authored document fields

### Requirement: DocumentRepository SHALL persist local draft edit history
The repository SHALL support local durable draft-edit history for document-changing edit sessions without treating that history as committed authored CAD state.

#### Scenario: Draft session survives refresh
- **WHEN** a covered draft edit session has recorded local durable draft-history groups and the local editing context refreshes
- **THEN** the repository can restore the local draft-history state for that session
- **AND** committed authored document state remains distinct from uncommitted draft state

#### Scenario: Explicit draft cancellation clears draft history
- **WHEN** the user explicitly cancels or abandons a draft edit session
- **THEN** the repository clears the local draft-history state for that session
- **AND** committed authored document history remains intact
