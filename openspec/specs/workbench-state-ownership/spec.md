# workbench-state-ownership Specification

## Purpose
TBD - created by archiving change stabilize-workbench-state-ownership. Update Purpose after archive.
## Requirements
### Requirement: Workbench state SHALL have one authoritative owner per concern
The workbench SHALL assign each state concern to one authoritative owner and SHALL NOT rely on overlapping ownership between shell-local React state, application controllers, editor runtime state, and durable modeling state.

#### Scenario: Shell-local UI state remains local
- **WHEN** the workbench tracks sidebar width, modal visibility, or other purely presentational layout state
- **THEN** that state is owned by the shell or a presentation-local controller
- **AND** it does not become the source of truth for document mutations, history sequencing, or import-session progression

#### Scenario: Document-facing editor state remains runtime-owned
- **WHEN** the workbench tracks active command sessions, document refresh progress, or accepted mutation sequencing
- **THEN** that state is owned by the editor runtime
- **AND** application controllers and shell-local state do not maintain competing authoritative copies

### Requirement: Application controllers SHALL coordinate browser-facing work without owning accepted document state
Application-layer controllers SHALL own browser-facing coordination such as file pickers, popup launches, shortcut trigger mapping, and notification dispatch, but SHALL hand accepted document mutations and refresh sequencing to the authoritative runtime-owned path.

#### Scenario: Controller gathers browser input
- **WHEN** a workbench flow requires a browser file picker, prompt, popup, or other browser-facing action
- **THEN** an application controller performs that coordination
- **AND** the controller hands the resulting request into the authoritative document-state owner rather than mutating document state itself

#### Scenario: Controller reports workbench feedback
- **WHEN** a document-facing workbench flow succeeds or fails
- **THEN** an application controller may emit notifications or user feedback
- **AND** that feedback state does not replace the authoritative mutation or refresh state

### Requirement: Ordinary workbench mutations SHALL not rely on ad hoc refresh repair
The workbench SHALL not treat direct modeling-service mutation plus `document.refreshRequested` or manual snapshot patching as the standard sequencing pattern for ordinary workbench actions.

#### Scenario: Rename or variable update succeeds
- **WHEN** the user completes an ordinary workbench action such as rename or document-variable update
- **THEN** the accepted document change is sequenced through the authoritative document-state owner
- **AND** the workbench does not depend on a separate ad hoc refresh repair path to reconcile ownership

#### Scenario: Import completion succeeds
- **WHEN** a generic part import commit succeeds
- **THEN** post-import document refresh and any reopen behavior are sequenced through the authoritative document-state owner
- **AND** the shell does not manually patch snapshots to finalize the import flow

### Requirement: Whole-document replacement SHALL use an explicit replacement handoff
Flows that replace the active document basis, such as opening or importing a whole document file, SHALL use an explicit document-replacement handoff instead of sharing the same path as ordinary incremental mutations.

#### Scenario: Local document file is opened
- **WHEN** the user opens a different document file
- **THEN** the workbench performs an explicit document-replacement handoff into the authoritative editor state owner
- **AND** the replacement path is treated distinctly from ordinary rename, edit, or history mutation flows

#### Scenario: Imported document replaces the active basis
- **WHEN** a whole-document import replaces the active authored document
- **THEN** the workbench uses the explicit replacement handoff
- **AND** any shell-local cleanup is limited to presentation state reset after the replacement is accepted

