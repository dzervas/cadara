## ADDED Requirements

### Requirement: Shared history coordination SHALL not maintain competing authoritative document history state
The shared workbench history coordinator SHALL select and dispatch the active undo context, but SHALL NOT become a competing authoritative owner of document-facing history state that already belongs to editor runtime or durable modeling history.

#### Scenario: History request is coordinated
- **WHEN** the user requests Undo or Redo through toolbar or shortcut entrypoints
- **THEN** the shared history coordinator selects the active undo context and dispatches the request through the authoritative owner for that context
- **AND** the coordinator does not finalize accepted document-facing history changes by patching snapshots itself

#### Scenario: Document-facing history result is accepted
- **WHEN** a document-facing history action is accepted
- **THEN** the authoritative runtime-owned path sequences any required follow-up refresh
- **AND** the history coordinator remains a dispatcher rather than a second document-state store
