# durable-document-history Specification

## Purpose
TBD - created by archiving change unify-authored-document-undo-redo. Update Purpose after archive.
## Requirements
### Requirement: Durable document history SHALL have one dedicated coordination boundary
The system SHALL define one dedicated durable document history boundary that owns undo-context selection, undo/redo availability, and request dispatch for document-changing actions without requiring hooks, components, or reducers to maintain their own competing undo state.

#### Scenario: Toolbar and shortcut request undo
- **WHEN** the user activates Undo from the toolbar or a keyboard shortcut
- **THEN** both entrypoints call the same durable document history boundary
- **AND** no UI adapter maintains a separate authoritative undo stack

#### Scenario: Multiple history contexts are possible
- **WHEN** an active draft edit history and durable committed document history both exist
- **THEN** the dedicated durable document history boundary selects the active undo context according to shared policy
- **AND** callers do not implement private fallback ordering themselves

### Requirement: Durable undo and redo SHALL be repository-backed history groups
Undoable document-changing actions SHALL be recorded and applied as repository-backed history groups on top of the local durable document store rather than as React-local inverse payload stacks.

#### Scenario: Durable document mutation is accepted
- **WHEN** a document-changing mutation such as rename, variable edit, delete, reorder, sketch commit, or feature update is accepted
- **THEN** the repository-backed durable history records one local undo group for that action
- **AND** Redo history after the active group is cleared according to standard linear undo semantics

#### Scenario: Undo reverts the last durable group
- **WHEN** the user requests Undo and a local durable history group is available
- **THEN** the repository-backed durable history restores the previous local durable group
- **AND** the caller does not reconstruct the inverse by replaying mutation-specific UI bookkeeping

### Requirement: Draft edit history SHALL use the same durable substrate
Document-changing draft edit workflows SHALL use repository-backed local draft history so the user-visible Undo and Redo model remains consistent while editing.

#### Scenario: Undo while editing a sketch draft
- **WHEN** a sketch draft session is active and the user requests Undo
- **THEN** the durable history boundary reverts the last draft history group for that session
- **AND** the visible sketch draft state updates without switching to document timeline rollback semantics

#### Scenario: Draft history is discarded explicitly
- **WHEN** the user cancels or abandons a draft edit session
- **THEN** the repository-backed local draft history for that session is discarded explicitly
- **AND** authored committed document history remains unchanged

### Requirement: Durable history SHALL remain local-session scoped
Repository-backed durable history metadata and draft-edit history SHALL remain local-session operational state rather than shared authored document state.

#### Scenario: Local tab receives peer-authored changes
- **WHEN** a peer-originated authored document change arrives
- **THEN** the local tab refreshes authored document state through normal repository/modeling paths
- **AND** the local durable history boundary does not reinterpret the peer-authored change as a locally undoable group

#### Scenario: Refresh restores local durable history
- **WHEN** the same local editing context refreshes after recording local durable history groups
- **THEN** local durable Undo and Redo availability is restored from repository-backed local history metadata
- **AND** that metadata remains distinct from canonical authored CAD state

### Requirement: Feature suppression mutations SHALL participate in durable document history
Suppressing or unsuppressing a feature SHALL be recorded as one repository-backed durable document history group and SHALL use the same undo/redo coordination boundary as other accepted document-changing mutations.

#### Scenario: Suppression records undo group
- **WHEN** a feature suppression mutation is accepted
- **THEN** durable document history records one undo group for that suppression state change
- **AND** undo restores the previous suppression state and refreshes the rebuilt snapshot

#### Scenario: Unsuppression records undo group
- **WHEN** a feature unsuppression mutation is accepted
- **THEN** durable document history records one undo group for that suppression state change
- **AND** undo restores the previous suppression state and refreshes the rebuilt snapshot

#### Scenario: Suppression no-op does not record history
- **WHEN** a suppression mutation requests the feature's existing suppression state
- **THEN** no durable undo group is recorded
- **AND** redo history is not changed

