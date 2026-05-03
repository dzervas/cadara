## ADDED Requirements

### Requirement: Durable document mutations SHALL be undone and redone through repository-backed history groups
Undoable durable document mutations SHALL be reversed and reapplied through repository-backed history groups instead of mutation-specific inverse stacks owned by workbench hooks.

#### Scenario: Undo durable variable rename or value edit
- **WHEN** the user changes a document variable name or value and the mutation is accepted
- **AND** the user later requests Undo
- **THEN** the accepted variable mutation is reverted through the durable history group recorded for that action
- **AND** the workbench does not depend on a React-local inverse entry for the variable

#### Scenario: Undo accepted document history reorder
- **WHEN** the user performs an accepted document history reorder
- **AND** the user later requests Undo
- **THEN** the reorder is reverted through the recorded durable history group
- **AND** Redo reapplies that same grouped reorder action

### Requirement: Sketch draft undo and redo SHALL restore durable draft state
While a document-changing sketch draft session is active, Undo and Redo SHALL restore the repository-backed draft state for that session rather than delegating to document timeline cursor movement.

#### Scenario: Undo restores deleted draft geometry and dependents
- **WHEN** the user deletes selected sketch draft geometry with dependent draft constraints or dimensions
- **AND** then requests Undo while the same draft session is active
- **THEN** the deleted geometry and its dependent draft constraints or dimensions are restored together from draft history
- **AND** the sketch draft session remains active

#### Scenario: Redo reapplies a reverted draft action
- **WHEN** a sketch draft action has been undone in the active draft session
- **AND** the user requests Redo
- **THEN** the reverted draft action is reapplied from the durable draft history substrate
- **AND** the workbench does not fall through to document timeline rollback

## MODIFIED Requirements

### Requirement: Toolbar history tools SHALL use the active undo context
The workbench SHALL route toolbar Undo and Redo actions to the active durable undo context instead of treating them as generic tool activations or document timeline cursor commands.

#### Scenario: Undo in sketch edit mode
- **WHEN** the user activates Undo while a sketch draft edit session with available draft history is active
- **THEN** the workbench requests one durable draft-history undo step from the shared history coordinator
- **AND** it does not call the document timeline cursor mutation service

#### Scenario: Redo in sketch edit mode
- **WHEN** the user activates Redo while a sketch draft edit session with redo history is active
- **THEN** the workbench requests one durable draft-history redo step from the shared history coordinator
- **AND** it does not call the document timeline cursor mutation service

#### Scenario: Undo outside sketch mode
- **WHEN** the user activates Undo outside sketch mode and a durable document history group exists
- **THEN** the workbench requests one durable document-history undo step from the shared history coordinator
- **AND** it does not move the document timeline cursor

#### Scenario: Redo outside sketch mode
- **WHEN** the user activates Redo outside sketch mode and a durable document history redo group exists
- **THEN** the workbench requests one durable document-history redo step from the shared history coordinator
- **AND** it does not move the document timeline cursor

### Requirement: Toolbar history availability SHALL be visible
The workbench SHALL derive Undo and Redo availability from the active durable draft-history context or repository-backed durable document history and expose unavailable actions as disabled toolbar controls.

#### Scenario: Draft history availability
- **WHEN** a sketch draft edit session is active
- **THEN** Undo availability is based on whether a previous durable draft-history group exists for that session
- **AND** Redo availability is based on whether a later durable draft-history group exists for that session

#### Scenario: Durable document history availability
- **WHEN** no draft edit session is active
- **THEN** Undo availability is based on whether the repository-backed durable document history exposes a local undo group
- **AND** Redo availability is based on whether the repository-backed durable document history exposes a local redo group

#### Scenario: Timeline rollback does not create undo availability
- **WHEN** the document timeline cursor can move but no durable draft-history or durable document-history group exists
- **THEN** toolbar Undo and Redo are unavailable
- **AND** availability is not borrowed from timeline cursor navigation

### Requirement: Workbench history actions SHALL resolve through one shared coordination path
The workbench SHALL resolve toolbar and shortcut Undo and Redo actions through one shared durable-history coordination path that is implemented behind a dedicated history module.

#### Scenario: Toolbar Undo and shortcut Undo share the same coordinator
- **WHEN** the user activates Undo from the toolbar
- **THEN** the workbench invokes the dedicated shared durable-history coordination path

- **WHEN** the user activates Undo from a keyboard shortcut
- **THEN** the workbench invokes that same dedicated shared durable-history coordination path

#### Scenario: Toolbar Redo and shortcut Redo share the same coordinator
- **WHEN** the user activates Redo from the toolbar
- **THEN** the workbench invokes the dedicated shared durable-history coordination path

- **WHEN** the user activates Redo from a keyboard shortcut
- **THEN** the workbench invokes that same dedicated shared durable-history coordination path

### Requirement: Shared history coordination SHALL preserve existing undo-context priority
The shared durable-history coordination path SHALL preserve explicit undo-context priority across active draft edit history and durable committed document history, while excluding document timeline cursor rollback from Undo and Redo semantics.

#### Scenario: Draft session has priority
- **WHEN** a draft edit session is active and Undo or Redo is requested through the shared durable-history coordination path
- **THEN** the request is resolved against draft edit history first
- **AND** the coordinator does not fall through to committed durable document history

#### Scenario: Durable committed history applies outside draft mode
- **WHEN** no draft edit session is active and a durable document undo or redo group exists
- **THEN** the shared durable-history coordination path resolves the request through committed durable history
- **AND** it does not fall through to document timeline cursor movement

### Requirement: Shared history coordination SHALL not maintain competing authoritative document history state
The shared durable-history coordinator SHALL select and dispatch the active undo context, but SHALL NOT become a competing owner of document-facing history state outside the authoritative durable history substrate and runtime sequencing path.

#### Scenario: History request is coordinated
- **WHEN** the user requests Undo or Redo through toolbar or shortcut entrypoints
- **THEN** the shared durable-history coordinator selects the active undo context and dispatches the request through the authoritative durable history owner for that context
- **AND** the coordinator does not patch snapshots or maintain a second authoritative document stack in UI state

#### Scenario: Document-facing history result is accepted
- **WHEN** a durable history action is accepted
- **THEN** the authoritative repository/runtime-owned path sequences any required follow-up refresh
- **AND** the history coordinator remains a dispatcher rather than a second document-state store

## REMOVED Requirements

### Requirement: Sketch undo and redo SHALL move the sketch-local cursor
**Reason**: Undo ownership is being moved off sketch-session-local cursor mechanics and onto the shared repository-backed durable draft-history substrate.
**Migration**: Route sketch draft Undo and Redo through the dedicated durable-history coordinator and restore visible sketch draft state from durable draft history instead of relying on the old sketch-local cursor behavior as the authoritative user-visible model.

### Requirement: Variable edit undo and redo SHALL restore variable values
**Reason**: Variable edits become one example of generic repository-backed durable history groups instead of a special-case workbench-local inverse stack.
**Migration**: Record accepted variable edits through the durable history grouping seam and let Undo and Redo replay them through repository-backed durable history.

### Requirement: Sketch geometry deletion SHALL be restored by sketch-local undo
**Reason**: Sketch deletion recovery now belongs to the shared durable draft-history substrate rather than a distinct sketch-local undo owner.
**Migration**: Keep the atomic restore behavior, but implement it through durable draft-history groups that the shared history coordinator uses while the draft session is active.

### Requirement: Document undo and redo SHALL use editor-owned cursor mutations
**Reason**: Document timeline cursor rollback remains a separate CAD navigation action and is no longer the fallback meaning of Undo and Redo.
**Migration**: Preserve explicit timeline rollback controls, but remove Undo and Redo fallback routing to document cursor mutation requests.

### Requirement: Document undo and redo SHALL be unavailable during pending cursor refresh
**Reason**: Cursor refresh sequencing no longer defines Undo and Redo availability once timeline cursor rollback is separated from Undo and Redo semantics.
**Migration**: Base Undo and Redo availability on durable draft-history and durable document-history availability instead of pending cursor refresh state.

### Requirement: Document history reorder undo and redo SHALL restore accepted orders
**Reason**: Accepted document history reorders become ordinary durable history groups rather than a dedicated workbench-local undo entry type.
**Migration**: Record accepted reorders through the durable history grouping seam and let Undo and Redo restore them through repository-backed durable history.
